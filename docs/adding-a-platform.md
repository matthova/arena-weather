# Adding a platform (iOS, Android, desktop, …)

Every client of Weather alerts is a thin shell over one API. The web app (`apps/web`) is the
reference client; a native app does the same four things:

1. **Talk to the API** (JSON over HTTPS, under `/api`).
2. **Authenticate** (Better Auth: Google or e-mail + password; a session cookie or a bearer token).
3. **Register a push channel** so the 15-minute checker can reach the device.
4. **Author rules as the shared rule JSON** (`packages/core`), and let the server evaluate them.

`packages/core` is the contract. It is plain TypeScript with no runtime dependency besides zod,
so it is the thing to port (or to read while porting): rule schema, variable catalogue, evaluator,
wire types and a typed client. Keep the JSON shapes identical across platforms; nothing in the API
is web-specific.

## 1. Talking to the API

Base URL: the API's public origin (in production the web app forwards `/api/*` to the API Worker,
so `https://<web-host>/api/...` and `https://<api-host>/api/...` are the same thing; native clients
can use either, prefer the API host). Everything is JSON; errors are
`{ "error": { "code", "message", "issues?" } }` with a 4xx/5xx status.

| Purpose | Request | Notes |
| --- | --- | --- |
| What is configured | `GET /api/config` | `{ googleSignIn, push, devMailbox }`: hide what the deployment lacks |
| Variable catalogue | `GET /api/variables` | Same list as `VARIABLES` in `packages/core/src/variables.ts` (name, label, unit, granularity) |
| Current user | `GET /api/me` | `{ user: null }` when signed out |
| Place search | `GET /api/places/search?q=Berlin&count=8` | Open-Meteo geocoding; take `label`, `latitude`, `longitude`, `timezone` into the rule's `place` |
| Forecast | `GET /api/forecast?latitude=&longitude=&timezone=` | `current` + `hourly` (2 days) + `daily` (7 days); times are unix seconds, `utcOffsetSeconds` gives local time. Optional `hourly=`/`daily=` add variables |
| Rules | `GET/POST /api/rules`, `GET/PUT/DELETE /api/rules/:id` | Body = rule definition (below); responses wrap it as `{ rule }` with `id`, `paused`, `armed`, `lastFiredAt`, … |
| Pause / resume | `POST /api/rules/:id/pause`, `POST /api/rules/:id/resume` | Resume re-arms |
| Test now | `POST /api/rules/:id/test` | Evaluates against the live forecast, pushes to every device of the user, returns `{ evaluation, message, push: { attempted, delivered, failed } }` |
| Push | `GET /api/push/public-key`, `GET/POST/DELETE /api/push/subscriptions` | See §3 |

`packages/core/src/client.ts` (`createWeatherClient`) is the exact list, with TypeScript types for
every request and response: mirror it in Swift/Kotlin, or generate from it.

## 2. Authentication

The API uses [Better Auth](https://better-auth.com) mounted at `/api/auth/*`. Its endpoints are
plain HTTP, so any platform can call them:

| Step | Request |
| --- | --- |
| Sign up with e-mail | `POST /api/auth/sign-up/email` `{ name, email, password, callbackURL }` → verification e-mail; sign-in is refused (`403 EMAIL_NOT_VERIFIED`) until the link is opened |
| Sign in with e-mail | `POST /api/auth/sign-in/email` `{ email, password }` |
| Resend verification | `POST /api/auth/send-verification-email` `{ email, callbackURL }` |
| Google | `POST /api/auth/sign-in/social` `{ provider: "google", callbackURL }` → `{ url }` to open; the browser flow ends on `callbackURL` with a session |
| Session | `GET /api/auth/get-session` |
| Sign out | `POST /api/auth/sign-out` |

**Where the session lives.** Today the session is a cookie (`better-auth.session_token`, `HttpOnly`,
`Secure`). This is fine for:

- the web app (first-party cookie through the `/api` proxy);
- iOS `URLSession` and Android OkHttp with a cookie jar: they store and resend it automatically.

For a cleaner native story, enable Better Auth's
[`bearer` plugin](https://better-auth.com/docs/plugins/bearer) in `apps/api/src/auth.ts`
(`plugins: [bearer()]`). The sign-in response then carries the token in the `set-auth-token` header,
and clients send `Authorization: Bearer <token>` instead of the cookie. `createWeatherClient` already
accepts `headers: { authorization: ... }` for this. Store the token in the Keychain / EncryptedSharedPreferences.

**Google on native.** `sign-in/social` is a browser redirect flow. Use `ASWebAuthenticationSession`
(iOS/macOS) or Custom Tabs (Android) with a `callbackURL` that is a universal/app link back into the
app, then read the session. The redirect URI registered at Google stays the API's
`<API_URL>/api/auth/callback/google`. A native Google Sign-In SDK can also hand its ID token to
`POST /api/auth/sign-in/social` `{ provider: "google", idToken: { token } }`.

**E-mail verification on native.** The link in the e-mail points at the API, which verifies, signs
the user in and redirects to `callbackURL`. Pass a `callbackURL` your app owns (universal link or
custom scheme, add it to `TRUSTED_ORIGINS` on the API), or just land on the web app.

## 3. Push registration

The API stores **push subscriptions per user** and fans every notification out to all of them. On the
web these are [Web Push](https://developer.mozilla.org/docs/Web/API/Push_API) subscriptions; the
server signs with VAPID and encrypts per RFC 8291 (`apps/api/src/push/webpush.ts`, WebCrypto only).

What the web client does (`apps/web/src/lib/push.ts`):

1. `GET /api/push/public-key` → VAPID public key.
2. `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
3. `POST /api/push/subscriptions` `{ subscription: { endpoint, keys: { p256dh, auth }, expirationTime }, userAgent }` (idempotent: upsert by endpoint).
4. Unregister with `DELETE /api/push/subscriptions` `{ endpoint }`.

The service worker (`apps/web/public/sw.js`) receives the payload, which is the API's `PushMessage`:

```json
{ "title": "Wet and windy evening", "body": "Precipitation chance >= 60 % … in Berlin", "url": "https://app/rules/<id>", "tag": "rule-<id>", "data": { "ruleId": "…", "matched": true } }
```

**Native platforms** need a second delivery channel: APNs (iOS/macOS) and FCM (Android), and
Windows (WNS) later. The shape is the same, only the transport differs. The intended extension is:

- a `channel` column on `push_subscription` (`webpush` | `apns` | `fcm`), with the device token in
  `endpoint` and no `p256dh`/`auth` for native channels;
- `POST /api/push/subscriptions` accepting `{ channel: "apns", token, userAgent }`;
- a sender per channel next to `webpush.ts`, chosen in `apps/api/src/notify.ts` (`notifyUser`),
  which already loops over all of a user's subscriptions and prunes dead ones (404/410);
- the notification payload keeps `title`, `body`, `url`/`ruleId`, `tag` (collapse id).

Until that lands, a native app can still exercise everything except delivery: rules, forecasts,
"Test this rule now" (its JSON response includes the evaluation and the message text).

PWA note: on iOS, web push only works for an installed PWA (iOS 16.4+); the web app ships a manifest
and service worker so it can be added to the Home Screen.

## 4. Rule JSON

A rule is a **place**, an optional **time window**, and a tree of **conditions** in nested `all`
(AND) / `any` (OR) groups. The server validates with the zod schema in
`packages/core/src/rule.ts` (`ruleDefinitionSchema`) and rejects anything else with `400` and
`issues`.

```jsonc
{
  "name": "Wet and windy evening",
  "place": { "label": "Berlin", "latitude": 52.52, "longitude": 13.41, "timezone": "Europe/Berlin" },
  "window": {                       // optional; defaults: next 24 h (hourly), next 7 days (daily)
    "hoursAhead": 12,               // 1..168
    "daysAhead": 3,                 // 1..7, today = 1
    "hoursOfDay": { "from": 17, "to": 22 }   // local hours, inclusive; from > to wraps midnight
  },
  "root": {
    "type": "group", "operator": "all",
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

Rules of the schema (enforce them in the builder so users get instant feedback, the server
enforces them again):

- `variable` must be one of `HOURLY_VARIABLES` / `DAILY_VARIABLES` for its `granularity`
  (`GET /api/variables` returns the same list with labels and units for the UI).
- `comparator` ∈ `<  <=  >  >=  ==  !=`; `value` is a finite number in the variable's unit.
- `quantifier` (optional, default `"any"`): `"any"` = at least one sample in the window satisfies the
  condition; `"all"` = every sample does.
- Groups have 1..20 children, nest at most 5 levels; the root is always a group.
- Optional `id` on nodes (≤ 64 chars) is echoed back in evaluations, handy for highlighting.

Semantics (so native UIs can explain results the same way): the checker runs every 15 minutes,
evaluates each active rule against a fresh forecast, **fires once** when the rule turns true and
**re-arms** when it turns false again (`armed` on the rule). `POST /api/rules/:id/test` returns the
same `RuleEvaluation` tree the checker computes: per condition `holds`, `sampleCount`, `matchCount`,
`firstMatch`. `describeCondition` / `describeEvaluation` in `packages/core/src/evaluate.ts` produce
the notification text; reuse their wording.

### How the web builder maps UI state to this JSON

`apps/web/src/lib/rule-draft.ts` is a small, dependency-free module worth copying: an editable draft
tree (text fields stay text while typing, every node has a stable key), `toDefinition(draft)` that
produces the JSON above and validates it with the core schema, and `draftFromDefinition(rule)` for
editing. Its tests (`rule-draft.test.ts`) double as examples of valid and invalid rules.

## Checklist for a new client

- [ ] Point at the API origin; handle `{ error }` responses and `401` (sign in again).
- [ ] Sign up / sign in / sign out via `/api/auth/*`; surface "e-mail not verified" with a resend button.
- [ ] Place search + forecast screen (current, 24 h, 7 days) from `/api/places/search` and `/api/forecast`.
- [ ] Rule list with pause/resume/delete, and a builder that emits the rule JSON (validate with the same rules).
- [ ] Register a push channel for the device; show registered devices; unregister on sign-out.
- [ ] "Test this rule now" button showing the evaluation tree.
- [ ] Read `GET /api/config` and hide Google / push when they are not configured.
