# Weather alerts — iOS app (Swift, SwiftUI, iOS 17+)

The native iOS client of the same API and accounts as the web app: forecast for a searched place or
your location, the rule builder (nested all/any groups over every hourly/daily variable, saved as
the shared rule JSON), the rules list with pause/resume/delete and **Test this rule now**, and APNs
push. No App Store account is assumed: everything below runs from source.

## Layout (multiplatform-ready)

```
apps/ios/
  project.yml                   XcodeGen spec → WeatherAlerts.xcodeproj (generated, git-ignored)
  Config/Shared.xcconfig        team id / bundle id / default API URL; Local.xcconfig overrides (git-ignored)
  Packages/WeatherAlertsKit/    Swift package, no UI (iOS 17 + macOS 14): rule JSON models, variable
                                catalogue, RuleDraft (builder state → validated JSON), Describe/WeatherFormat,
                                WeatherAPIClient (URLSession, bearer token in the Keychain), XCTest suite
  Sources/Shared/               SwiftUI screens and app state (AppModel), platform-neutral: the macOS target
                                of slice 3 compiles this folder as is
  Sources/iOS/                  the iOS entry point: @main App, AppDelegate (APNs token, notification taps),
                                APNsRegistrar, Info.plist, entitlements, asset catalogue
  scripts/make-app-icon.mjs     renders the app icon from the web app's motif (already committed)
```

`Sources/Shared` talks to the platform through two small protocols, `PushRegistrar` (permission +
device token) and `WebAuthenticating` (the Google browser sheet), implemented in `Sources/iOS`;
macOS adds `Sources/macOS` with its own implementations and a second target in `project.yml`.

## Run it from source

Prerequisites: macOS with Xcode 15.3 or newer (iOS 17 SDK) and [XcodeGen](https://github.com/yonaskolb/XcodeGen)
(`brew install xcodegen`). The API runs locally with `pnpm dev` from the repo root (see the root README).

```sh
cd apps/ios
xcodegen generate                  # writes WeatherAlerts.xcodeproj from project.yml
open WeatherAlerts.xcodeproj       # pick an iPhone simulator, ⌘R
```

In the simulator the app talks to `http://localhost:8787` (the API of `pnpm dev`). Sign up with an
e-mail address: without a mail provider the API keeps the verification e-mail in its dev outbox, and
the app's "Confirm your e-mail" screen has a **Confirm from the dev outbox** button that opens the link
for you and signs you in. Create a rule, press **Test this rule now**.

The server address lives under **Account → Server** (persisted); the compile-time default is
`WEATHER_ALERTS_API_URL` in `Config/Shared.xcconfig`.

### On a device (needed for push)

APNs needs a real device, an Apple Developer team, and a bundle id you own. Create `Config/Local.xcconfig`
(git-ignored):

```
WEATHER_ALERTS_TEAM = ABCDE12345
WEATHER_ALERTS_BUNDLE_ID = com.yourname.weatheralerts
WEATHER_ALERTS_API_URL = http:/$()/192.168.1.20:8787     // your Mac's LAN address, or the deployed API
```

Xcode's automatic signing then adds the Push Notifications capability from the checked-in
entitlements (`aps-environment`). On the API side set the APNs key (next section) with
`APNS_BUNDLE_ID` equal to the bundle id above. Plain-http LAN addresses work because `Info.plist`
allows local networking; production is https.

### Swift package tests

```sh
cd apps/ios/Packages/WeatherAlertsKit
swift test            # 28 tests: rule JSON round-trip, builder validation, describe/format, API client against a stub URLProtocol
```

They also run on Linux (the package is Foundation-only), and in CI on a macOS runner together with
`xcodebuild build` of the app (`.github/workflows/ci.yml`, job `ios`).

## Push (APNs)

Token-based authentication with a `.p8` key, so one key serves every app and both APNs
environments, and nothing expires yearly:

1. Apple Developer → Certificates, Identifiers & Profiles → **Keys** → `+`, tick *Apple Push
   Notifications service (APNs)*, download `AuthKey_<KEYID>.p8` (once!), note the Key ID and your
   Team ID (top right of the portal).
2. On the API (`apps/api`): locally in `.dev.vars`, in production as Worker secrets:

   ```sh
   cd apps/api
   pnpm exec wrangler secret put APNS_TEAM_ID       # ABCDE12345
   pnpm exec wrangler secret put APNS_KEY_ID        # the key id
   pnpm exec wrangler secret put APNS_PRIVATE_KEY < ~/Downloads/AuthKey_XXXXXXXXXX.p8
   ```

   and in `wrangler.jsonc` `vars`: `APNS_BUNDLE_ID` (= `WEATHER_ALERTS_BUNDLE_ID`), optionally
   `APNS_ENVIRONMENT` (`production`, the default, or `sandbox`). `GET /api/config` then reports
   `pushChannels.apns: true` and the app's Account tab shows "configured".
3. In the app: **Account → Enable notifications on this device** asks for permission, gets the token
   from APNs and registers it with `POST /api/push/devices { channel: "apns", token, userAgent }`.
   Tokens are re-registered silently on later launches (they can rotate) and forgotten on sign-out.
   **Test this rule now** on any rule sends a push immediately; the 15-minute checker sends one when a
   rule becomes true. A tap opens the rule.

How the server sends (`apps/api/src/push/apns.ts`): an ES256 provider token (`kid`, `iss` = team id,
`iat`) signed with WebCrypto from the `.p8`, cached for 50 minutes, `POST https://api.push.apple.com/3/device/<token>`
with `apns-topic` = bundle id, `apns-push-type: alert`, `apns-collapse-id` = the rule's tag, and an
`aps` alert plus the same `url`/`tag`/`data` fields as the web payload. Debug builds get **sandbox**
tokens: the API tries its configured host first and retries once on the other one when Apple answers
`BadDeviceToken`, so one deployment serves Xcode builds and TestFlight builds. `410 Unregistered` /
`BadDeviceToken` on both hosts deletes the token.

Caveats: the iOS **simulator** does not get APNs tokens (the button reports a timeout; use a device).
APNs requires HTTP/2, which Cloudflare's `fetch` negotiates with origins that support it; this was not
exercised against Apple from the sandbox the code was written in (see "What was verified").

## Sign-in

E-mail + password through Better Auth (`/api/auth/sign-in/email`). The session is the **bearer
token** the API returns in `set-auth-token` (Better Auth `bearer` plugin), stored in the Keychain and
sent as `Authorization: Bearer`; cookies are not relied on.

**Google** uses the browser flow with `ASWebAuthenticationSession`: the app asks the API for the
Google URL with `callbackURL = <API>/api/native/handoff?redirect=weatheralerts://auth/callback`.
After Google, Better Auth signs the *browser* in; the hand-off route turns that cookie session into a
3-minute one-time token (Better Auth `oneTimeToken` plugin) and redirects to the app, which exchanges
it at `/api/auth/one-time-token/verify` for a bearer session. Only URL schemes listed in the API var
`NATIVE_REDIRECT_SCHEMES` may receive the token. This needs `GOOGLE_CLIENT_ID/SECRET` on the API; the
button is hidden otherwise.

## Screens

| Tab | What |
| --- | --- |
| Forecast | Place search (sheet, debounced), **Use my location** (CoreLocation + reverse geocoding), current conditions, next 24 h strip, 7-day list; the last place is remembered; pull to refresh |
| Rules | List (swipe: pause/resume, delete) → detail (place, window, state, conditions tree, **Test this rule now** with the evaluation tree and push counts, pause/resume, delete) → editor: name, place picker, hours/days ahead, hours-of-day toggle with from/to, nested all/any groups, per-condition hourly/daily switch, variable, comparator, value, any/every sample; add/remove conditions and groups; the same limits as the server (≤ 20 per group, ≤ 5 levels) with inline errors |
| Account | Signed-in user, notifications for this device (state spelled out, incl. "server has no APNs key"), registered devices of the account (browsers, phones; swipe to unregister), server address, sign out; sign-in / sign-up / confirm-e-mail flows |

## What was verified, and what was not

The sandbox this was built in is Linux without Xcode. What ran:

- `apps/api`: the whole vitest suite in the Workers runtime, including the new APNs tests (JWT
  verifies against the key's public half, token caching, request headers/body, 410/BadDeviceToken →
  gone, host fallback, device registration, `notifyUser` dispatch, "test this rule now" to an APNs
  device, the Google hand-off).
- `WeatherAlertsKit`: `swift build` and `swift test` (28/28) with the Swift 5.10 Linux toolchain;
  `AppModel`, `PushTokenRelay`, `RulesStore`, `AppSettings` type-checked against it with `swiftc`.
- Every file under `Sources/` parses (`swiftc -parse`); the SwiftUI/UIKit/CoreLocation code could not
  be type-checked or run here.

Not run: `xcodegen generate` + `xcodebuild`, the simulator, a device, APNs against Apple, Google
sign-in. First-run checklist on a Mac:

- [ ] `xcodegen generate` succeeds; the project builds for a simulator (CI's `ios` job does this).
- [ ] Sign up → "Confirm from the dev outbox" → signed in; sign out / sign in again (token in Keychain).
- [ ] Forecast: search a place; "Use my location" (allow when asked); last place restored on relaunch.
- [ ] Rules: create the README example (nested any-group, hours-of-day window), edit it, pause/resume,
      delete; invalid value shows an inline error; **Test this rule now** shows the tree.
- [ ] Device with `Local.xcconfig` + APNs secrets: enable notifications → "registered"; **Test this rule
      now** → banner arrives (foreground and background); tap opens the rule; sign out removes the device.
- [ ] Debug build with `APNS_ENVIRONMENT=production` on the API still delivers (sandbox retry).
- [ ] Google (with `GOOGLE_CLIENT_ID/SECRET` and `TRUSTED_ORIGINS` covering the API host): the sheet
      returns to the app signed in.
