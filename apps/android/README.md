# Weather alerts for Android

Native Android client of the same API the web app uses: Kotlin, Jetpack Compose, Material 3,
`minSdk 26` (Android 8.0), `targetSdk 35`. Gradle Kotlin DSL with a version catalog
(`gradle/libs.versions.toml`); Ktor (OkHttp engine) + kotlinx.serialization for the API;
Preferences DataStore for the session; Firebase Cloud Messaging for push.

No store account is assumed: run it from source.

## Run it

Prerequisites: JDK 17 and an Android SDK (Android Studio installs both; or the command-line tools
with `platforms;android-35`, `build-tools;35.0.0`, `platform-tools`). Point the build at the SDK
with `ANDROID_HOME` or `apps/android/local.properties` (`sdk.dir=/path/to/sdk`).

```sh
# 1. start the API (and the web app, for the e-mail verification link) from the repo root
pnpm dev

# 2. build, test, install
cd apps/android
./gradlew assembleDebug          # apps/android/app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest      # JVM unit tests (rule JSON, builder validation, API client)
./gradlew installDebug           # onto the running emulator / connected phone (adb)
```

Or open `apps/android` in Android Studio and press Run.

**Which server the app talks to.** The debug build defaults to `http://10.0.2.2:8787`, which is the
host machine's `localhost:8787` as seen from the Android emulator (the API Worker from `pnpm dev`).
Change it without rebuilding on the sign-in screen ("Server: …"), or at build time:

```properties
# apps/android/local.properties (git-ignored)
arena.apiBaseUrl=http://192.168.1.20:8787                # a phone on the same Wi-Fi as `pnpm dev`
arena.apiBaseUrl=https://arena-weather-api.<account>.workers.dev   # the deployed API
```

Debug builds allow plain `http` (`src/debug/res/xml/network_security_config.xml`); release builds are
HTTPS only.

**Sign in.** Same accounts as the web app (Better Auth). E-mail + password: sign up in the app, open
the confirmation link (locally the API has no mail provider, so the "Confirm your e-mail" screen can
fetch the link from the API's dev outbox and open it), then sign in. The app keeps the session as a
bearer token (the API's Better Auth `bearer` plugin, `set-auth-token` → `Authorization: Bearer`),
stored in DataStore.

**Google sign-in** is offered when the API reports `googleSignIn: true` (`GET /api/config`) *and*
the build knows the OAuth **web** client id the API uses:

```properties
arena.googleWebClientId=1234567890-xxxx.apps.googleusercontent.com   # the same GOOGLE_CLIENT_ID as the API
```

plus an **Android** OAuth client in the same Google Cloud project (package `com.arenaweather.app.debug`
/ `com.arenaweather.app`, your signing certificate's SHA-1: `./gradlew signingReport`). The app
asks Credential Manager for a Google ID token and posts it to `POST /api/auth/sign-in/social`
`{ provider: "google", idToken: { token } }`. This path is wired but was not exercised here (no
Google project in the sandbox).

## Push notifications (FCM)

Delivery is Firebase Cloud Messaging (HTTP v1); the API side lives in `apps/api/src/push/fcm.ts`.
Three things have to be in place; the **Alerts** tab in the app shows which of them are:

1. **`apps/android/app/google-services.json`** — download it from the Firebase console (Project
   settings → Your apps → Android app with package `com.arenaweather.app`; add a second Android app
   for `com.arenaweather.app.debug` or the debug build will not get a token). The file names your
   Firebase project and is **not committed** (`.gitignore`); `app/google-services.json.example` shows
   the shape. The Gradle build applies the `google-services` plugin only when the file exists, so a
   fresh clone compiles either way; without it the app runs with push disabled and says so.
2. **Notification permission** (Android 13+): the Alerts tab asks for it.
3. **`FCM_SERVICE_ACCOUNT` on the API** — the service-account key JSON (Firebase console → Project
   settings → Service accounts → Generate new private key), set as a Worker secret
   (`pnpm --filter @arena-weather/api exec wrangler secret put FCM_SERVICE_ACCOUNT`) or in
   `apps/api/.dev.vars` on one line. The API mints an RS256 JWT with it, exchanges it for an OAuth
   token and posts to `fcm.googleapis.com/v1/projects/<project>/messages:send`. Without it, Android
   devices register fine but `GET /api/config` reports `pushChannels.fcm: false` and the Alerts tab
   shows step 4 unticked.

Once signed in, the app registers its FCM token with `POST /api/push/devices`
`{ channel: "fcm", token, userAgent }` (again after Firebase rotates the token, via
`AlertsMessagingService.onNewToken`), and unregisters on sign-out. From then on the device receives
whatever the user's web browsers receive: the 15-minute checker's alerts and **Test this rule now**.
Messages carry a `notification` (shown by Android in the background on the `weather_alerts`
channel) and the same `data` fields the web service worker gets (`title`, `body`, `url`, `tag`,
`ruleId`, `matched`); tapping one opens the rule.

## Screens

| Tab / screen | What |
| --- | --- |
| Forecast | Place search (`/api/places/search`), "use my location" (fused location + Geocoder label), current conditions, next 24 h, 7 days; the last place is remembered; "New rule here" |
| Rules | List with status (armed / fired / paused), pause–resume, **Test now**; tap for details |
| Rule detail | Place, window, conditions, last checked / fired; **Test this rule now** shows the evaluation tree (`holds`, matches, first matching sample), the notification text and how many devices were reached; edit, pause, delete |
| Rule editor | Name, place (search or location), optional window (hours ahead, days ahead, hours of day), nested **all / any** groups over any hourly or daily variable with comparator, value and any/every-sample quantifier; the same checks as the server's schema before saving as the shared rule JSON |
| Alerts | The four push prerequisites with fixes, register / re-register this device, preview a notification, every device on the account (browsers and phones), sign out, server address |
| Sign in / Sign up / Confirm your e-mail | Better Auth e-mail + password, Google when configured, resend verification, local dev outbox |

## Code map

```
app/src/main/java/com/arenaweather/app/
  WeatherApp.kt, AppContainer.kt     Application + hand-wired dependencies
  MainActivity.kt                     single activity; notification taps carry a ruleId
  data/rules/RuleModel.kt             the shared rule JSON as Kotlin (kotlinx.serialization, strict shapes)
  data/rules/Variables.kt             variable catalogue (copy of packages/core, refreshed from /api/variables)
  data/rules/RuleDraft.kt             builder state -> rule JSON + validation (port of apps/web/src/lib/rule-draft.ts)
  data/api/WeatherApi.kt, ApiModels.kt  Ktor client = packages/core/src/client.ts, bearer auth
  data/Settings.kt, Session.kt        DataStore (server, token, FCM token, last place); auth state
  data/push/PushRegistrar.kt          keeps the API's copy of the FCM token in step
  data/push/AlertsMessagingService.kt FirebaseMessagingService: onNewToken, foreground notifications
  data/location/LocationSource.kt     fused location -> Place
  data/weather/Format.kt              WMO codes, temperatures, times
  ui/                                 Compose screens (forecast, auth, rules, alerts) + AppRoot navigation
app/src/test/                         JVM unit tests
```

## Verification checklist (what was and was not run)

Run in CI and in the sandbox this was built in (Linux, JDK 17, SDK 35, no emulator):

- `./gradlew assembleDebug` — compiles, with and without `google-services.json`.
- `./gradlew testDebugUnitTest` — 19 tests: README rule example round-trips through the Kotlin model
  with exactly the schema's keys; builder validation mirrors the server (ranges, granularity,
  empty groups, depth ≤ 5); draft ↔ definition is lossless; API client paths, bearer header, both
  error shapes, `set-auth-token`, forecast / test-result / config parsing.
- `./gradlew lintDebug` — no errors.
- API: `pnpm --filter @arena-weather/api test` covers the FCM sender, device registration and the
  bearer session.

Not run here (needs an emulator or a phone; the sandbox has no KVM):

- [ ] Sign up → confirm (dev outbox link) → sign in; sign out; restart keeps the session.
- [ ] Forecast for a searched place and for the device location (permission prompt).
- [ ] Create a nested rule (all → any), see it in the web app with the same JSON; edit, pause, delete from the phone.
- [ ] Alerts tab: permission, device registered (`GET /api/push/subscriptions` shows a `fcm` row with this device's user agent).
- [ ] With `google-services.json` and `FCM_SERVICE_ACCOUNT`: **Test this rule now** → notification arrives in the background and in the foreground; tapping opens the rule; the cron alert arrives once when a rule turns true.
- [ ] Google sign-in with an Android OAuth client + web client id.
