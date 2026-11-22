# arena-weather

Weather alerts: pick a place, describe the weather you care about as a rule ("rain chance ≥ 60 % in the next 12 hours **and** wind gusts > 50 km/h"), and get a web push notification once when it becomes true. Forecasts come from [Open-Meteo](https://open-meteo.com); everything runs on Cloudflare (Workers, D1, Cron Triggers).

## Layout

```
apps/
  api/        Hono API on Cloudflare Workers + D1: auth, rules, forecasts, push, 15-minute checker
  web/        TanStack Start (React) on Cloudflare Workers: installable PWA, forecast, rule builder, web push
packages/
  core/       Shared TypeScript: rule schema (zod), pure evaluator, variable catalogue, typed API client
docs/
  adding-a-platform.md   How a new client (iOS, Android, desktop) talks to the API, auth, push, rule JSON
```

pnpm workspaces + Turborepo, TypeScript throughout, [Biome](https://biomejs.dev) for lint/format, [Vitest](https://vitest.dev) for tests (the API tests run inside the Workers runtime against a real local D1).

## Run it locally

Prerequisites: Node 22 (`.nvmrc`) and pnpm 10 (`corepack enable`).

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # fill in at least BETTER_AUTH_SECRET
pnpm --filter @arena-weather/api vapid:generate      # paste the two lines it prints into .dev.vars
pnpm db:migrate                                      # create the local D1 schema
pnpm dev                                             # web on http://localhost:3000, API on :8787, core in watch mode
```

Open <http://localhost:3000>: search a place, sign up with an e-mail address (no mail provider
locally, so the "Confirm your e-mail" page offers the verification link itself), create a rule, turn on
notifications and press **Test this rule now**. The browser only ever talks to `localhost:3000`: the
web Worker forwards `/api/*` to the API (`apps/web/src/routes/api.$.ts`), so the session cookie is a
plain first-party cookie and no CORS is involved, in development and in production alike.

Useful while developing:

```sh
curl localhost:8787/api/health
curl "localhost:8787/api/places/search?q=Berlin"
curl "localhost:8787/api/forecast?latitude=52.52&longitude=13.41"
curl "localhost:8787/__scheduled"                                  # run the cron checker now (wrangler --test-scheduled)
curl -X POST -H "authorization: Bearer $CHECKER_TOKEN" localhost:8787/api/internal/run-checker
```

Without `RESEND_API_KEY` verification e-mails are printed to the wrangler console and kept in memory
(`GET /api/dev/outbox`, served only when the API runs on localhost without a mail provider; the web
app's "Confirm your e-mail" page uses it). Without `GOOGLE_CLIENT_ID/SECRET` Google sign-in is not
offered (`GET /api/config` tells clients what is configured). Web push needs the VAPID keys.

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (the API build is a `wrangler deploy --dry-run`, the web build is `vite build`). The web tests (Vitest + Testing Library in jsdom) cover the rule builder's serialization to the shared rule JSON and the forecast rendering.

## Deploy

One-time setup (needs `wrangler login` or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in the environment):

```sh
cd apps/api
pnpm exec wrangler d1 create weather-alerts        # paste the printed database_id into wrangler.jsonc
for s in BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET RESEND_API_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY CHECKER_TOKEN; do
  pnpm exec wrangler secret put $s
done
```

Two Workers are deployed: `arena-weather-api` and `arena-weather-web`. The web Worker serves the app
and forwards `/api/*` to the API over a [service binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
(`apps/web/wrangler.jsonc` → `services: [{ binding: "API", service: "arena-weather-api" }]`), so
users see **one origin** (the web Worker's) and Better Auth works with ordinary first-party cookies.
Configure the API for that origin in `apps/api/wrangler.jsonc` `vars`:

```jsonc
"APP_URL": "https://arena-weather-web.<account>.workers.dev",   // or your custom domain
"API_URL": "https://arena-weather-web.<account>.workers.dev",   // same origin: auth links and OAuth callbacks go through the web Worker
"TRUSTED_ORIGINS": "https://arena-weather-web.<account>.workers.dev",
```

plus `EMAIL_FROM` and `VAPID_SUBJECT`. The Google OAuth redirect URI is then
`https://arena-weather-web.<account>.workers.dev/api/auth/callback/google`. (Serving the two Workers
on sibling hosts with CORS and `SameSite=None` cookies also works, `apps/api/src/auth.ts` switches
cookie attributes automatically when the hosts differ, but same-origin is simpler and is what the
web app assumes.) If the API should not be reachable on its own `workers.dev` host, add
`"workers_dev": false` to `apps/api/wrangler.jsonc`: the binding and the cron keep working.

Then, from the repo root:

```sh
pnpm run deploy        # core build → API: D1 migrations + wrangler deploy → web: vite build + wrangler deploy
```

(`pnpm run deploy`, not `pnpm deploy`: the latter is pnpm's own built-in command. The web deploy
runs after the API deploy because its service binding needs the API Worker to exist.)

GitHub Actions does the same on every push to `main` (`.github/workflows/deploy.yml`) using the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; `ci.yml` lints, builds, typechecks and tests pull requests (all three packages).

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
| `API_ORIGIN` | `apps/web/wrangler.jsonc` var | Where the web dev server forwards `/api` (default `http://localhost:8787`); production uses the `API` service binding instead |

Nothing secret is committed: locally they live in `apps/api/.dev.vars` (git-ignored), in production in Worker secrets. The web Worker has no secrets at all.

## Web app

`apps/web` is a TanStack Start app built with Vite and the Cloudflare Vite plugin (SSR runs in the
Worker). Screens:

| Route | What |
| --- | --- |
| `/` | Place search (Open-Meteo geocoding), current conditions, next 24 hours, 7 days; the last place is remembered; `?lat&lon&name&tz` makes it linkable |
| `/sign-in`, `/sign-up`, `/check-email` | Better Auth e-mail + password (verification flow surfaced, resend) and "Continue with Google" when configured |
| `/rules`, `/rules/new`, `/rules/$ruleId` | Rules list with pause / resume / delete / **Test this rule now** (shows the evaluation tree and push delivery), and the builder: nested all/any groups over any hourly or daily variable, comparator + value + quantifier, place picker, optional window (hours ahead, days ahead, hours of day). Saved as the shared rule JSON from `packages/core` |
| `/notifications` | Permission, subscribe / unsubscribe this device (VAPID key from the API), registered devices |
| `/api/*` | Server route forwarding to the API Worker (service binding in production, `API_ORIGIN` in dev) |

PWA: `public/manifest.webmanifest` + icons (regenerate with `node apps/web/scripts/make-icons.mjs`),
and `public/sw.js`, a plain service worker that caches the shell for offline starts, shows push
notifications (`push`), and focuses or opens the app on click (`notificationclick`). Install it from
the browser's "Install" / "Add to Home Screen" action. On iOS web push only works once installed.

Styling is plain CSS (`src/styles/app.css`, light/dark via `prefers-color-scheme`); data fetching is
TanStack Query over the typed client from `packages/core`.

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

- Replace the placeholder `database_id` in `apps/api/wrangler.jsonc` after `wrangler d1 create`, and set the production origins (see Deploy) before the first deploy; neither has been run against a real Cloudflare account yet (the sandbox has no credentials), only `wrangler deploy --dry-run`.
- Google sign-in and Resend are wired but untested end to end for the same reason.
- Native push channels (APNs/FCM) are not implemented; see `docs/adding-a-platform.md` for the intended shape.
- Password reset has an API (`/api/auth/forget-password`, `/api/auth/reset-password`) but no screen yet.
- Notification history is stored (`notification` table) but has no endpoint yet.
- Open-Meteo is free for non-commercial use; rate limits are generous but the checker fetches one forecast per distinct place per run (cached 10 minutes).
