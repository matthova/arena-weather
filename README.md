# arena-weather

Weather alerts: pick a place, describe the weather you care about as a rule ("rain chance ≥ 60 % in the next 12 hours **and** wind gusts > 50 km/h"), and get a web push notification once when it becomes true. Forecasts come from [Open-Meteo](https://open-meteo.com); everything runs on Cloudflare (Workers, D1, Cron Triggers).

## Layout

```
apps/
  api/        Hono API on Cloudflare Workers + D1: auth, rules, forecasts, push, 15-minute checker
  web/        (next) TanStack Start web app
packages/
  core/       Shared TypeScript: rule schema (zod), pure evaluator, variable catalogue, typed API client
```

pnpm workspaces + Turborepo, TypeScript throughout, [Biome](https://biomejs.dev) for lint/format, [Vitest](https://vitest.dev) for tests (the API tests run inside the Workers runtime against a real local D1).

## Run it locally

Prerequisites: Node 22 (`.nvmrc`) and pnpm 10 (`corepack enable`).

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # fill in at least BETTER_AUTH_SECRET
pnpm --filter @arena-weather/api vapid:generate      # paste the two lines it prints into .dev.vars
pnpm db:migrate                                      # create the local D1 schema
pnpm dev                                             # API on http://localhost:8787 (+ core in watch mode)
```

Useful while developing:

```sh
curl localhost:8787/api/health
curl "localhost:8787/api/places/search?q=Berlin"
curl "localhost:8787/api/forecast?latitude=52.52&longitude=13.41"
curl "localhost:8787/__scheduled"                                  # run the cron checker now (wrangler --test-scheduled)
curl -X POST -H "authorization: Bearer $CHECKER_TOKEN" localhost:8787/api/internal/run-checker
```

Without `RESEND_API_KEY` verification e-mails are printed to the wrangler console (copy the link). Without `GOOGLE_CLIENT_ID/SECRET` Google sign-in is simply not offered.

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (the API build is a `wrangler deploy --dry-run`).

## Deploy

One-time setup (needs `wrangler login` or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in the environment):

```sh
cd apps/api
pnpm exec wrangler d1 create weather-alerts        # paste the printed database_id into wrangler.jsonc
for s in BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET RESEND_API_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY CHECKER_TOKEN; do
  pnpm exec wrangler secret put $s
done
```

Set the public URLs in `apps/api/wrangler.jsonc` `vars` (`APP_URL`, `API_URL`, `TRUSTED_ORIGINS`, `EMAIL_FROM`, `VAPID_SUBJECT`). Then, from the repo root:

```sh
pnpm run deploy        # applies D1 migrations remotely, then `wrangler deploy`
```

(`pnpm run deploy`, not `pnpm deploy`: the latter is pnpm's own built-in command.)

GitHub Actions does the same on every push to `main` (`.github/workflows/deploy.yml`) using the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; `ci.yml` lints, builds and tests pull requests.

### Secrets and configuration

| Name | Where | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | secret | Session/token signing (32+ random chars) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secret | Google OAuth; redirect URI `<API_URL>/api/auth/callback/google` |
| `RESEND_API_KEY` | secret | Verification / reset e-mails via [Resend](https://resend.com) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | secret | Web push signing (`pnpm --filter @arena-weather/api vapid:generate`) |
| `CHECKER_TOKEN` | secret | Bearer token for `POST /api/internal/run-checker` |
| `APP_URL`, `API_URL`, `TRUSTED_ORIGINS` | `wrangler.jsonc` vars | Public origins (CORS, cookies, e-mail links) |
| `EMAIL_FROM`, `VAPID_SUBJECT`, `OPEN_METEO_*_URL` | `wrangler.jsonc` vars | Sender identity, upstream URLs |

Nothing secret is committed: locally they live in `apps/api/.dev.vars` (git-ignored), in production in Worker secrets.

## API

All JSON, under `/api`. Session cookie auth (Better Auth); `packages/core` exports a typed client (`createWeatherClient`) for all of it.

| Method & path | Auth | What |
| --- | --- | --- |
| `GET /health`, `GET /variables`, `GET /me` | – | Liveness, the rule variable catalogue, current user |
| `ALL /auth/*` | – | Better Auth: `sign-up/email`, `sign-in/email`, `sign-in/social` (google), `verify-email`, `sign-out`, … |
| `GET /places/search?q=` | – | Geocoding (Open-Meteo) |
| `GET /forecast?latitude=&longitude=[&timezone=&hourly=&daily=]` | – | Current + 7 days hourly + 7 days daily (unix times + `utcOffsetSeconds`) |
| `GET/POST /rules`, `GET/PUT/DELETE /rules/:id` | ✓ | Rules CRUD (body = rule definition, validated with zod) |
| `POST /rules/:id/pause`, `POST /rules/:id/resume` | ✓ | Pause/resume (resume re-arms) |
| `POST /rules/:id/test` | ✓ | Evaluate against the live forecast now and push the result to the caller's devices |
| `GET /push/public-key` | – | VAPID public key for `pushManager.subscribe` |
| `GET/POST/DELETE /push/subscriptions` | ✓ | Register (upsert by endpoint) / list / unregister push subscriptions |
| `POST /internal/run-checker` | token | Run the cron job on demand |

### Rules

```jsonc
{
  "name": "Wet and windy evening",
  "place": { "label": "Berlin", "latitude": 52.52, "longitude": 13.41, "timezone": "Europe/Berlin" },
  "window": { "hoursAhead": 12, "hoursOfDay": { "from": 17, "to": 22 } },   // optional; also daysAhead
  "root": {
    "type": "group", "operator": "all",                                       // all = AND, any = OR, nest freely
    "children": [
      { "type": "condition", "granularity": "hourly", "variable": "precipitation_probability", "comparator": ">=", "value": 60 },
      { "type": "group", "operator": "any", "children": [
        { "type": "condition", "granularity": "hourly", "variable": "wind_gusts_10m", "comparator": ">", "value": 50 },
        { "type": "condition", "granularity": "daily", "variable": "weather_code", "comparator": "==", "value": 95 }
      ]}
    ]
  }
}
```

A condition holds when **any** forecast sample in the window satisfies it (`"quantifier": "all"` requires every sample). The checker runs every 15 minutes: a rule **fires once** when its evaluation turns true and **re-arms** when it turns false again; paused rules are skipped. Trigger state (`armed`, `lastEvaluatedAt`, `lastFiredAt`) is stored per rule in D1.

Web push is implemented on WebCrypto only (`apps/api/src/push/webpush.ts`: VAPID ES256 JWT + RFC 8291 `aes128gcm`), verified in the Workers runtime against the RFC test vector; no Node-only dependency.

## Known gaps / next

- `apps/web` does not exist yet. Because the web app and the API are different origins, the dev server should proxy `/api` to `localhost:8787`; in production use sibling hosts over https (cookies are then `SameSite=None; Secure`).
- Replace the placeholder `database_id` in `apps/api/wrangler.jsonc` after `wrangler d1 create`.
- Notification history is stored (`notification` table) but has no endpoint yet.
- Open-Meteo is free for non-commercial use; rate limits are generous but the checker fetches one forecast per distinct place per run (cached 10 minutes).
