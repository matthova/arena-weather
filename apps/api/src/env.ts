/** Worker bindings. Non-secret values live in wrangler.jsonc `vars`; secrets in `wrangler secret` / .dev.vars. */
export interface Env {
  DB: D1Database;

  // vars
  APP_NAME: string;
  /** Public origin of the web app (for links in e-mails and CORS). */
  APP_URL: string;
  /** Public origin of this API (Better Auth baseURL, OAuth callbacks). */
  API_URL: string;
  /** Comma-separated origins allowed for CORS and Better Auth. */
  TRUSTED_ORIGINS: string;
  EMAIL_FROM: string;
  VAPID_SUBJECT: string;
  OPEN_METEO_FORECAST_URL: string;
  OPEN_METEO_GEOCODING_URL: string;
  /** Custom URL schemes of native apps allowed to receive a sign-in one-time token (GET /api/native/handoff). */
  NATIVE_REDIRECT_SCHEMES?: string;
  /** iOS/macOS app bundle id = the APNs topic (apps/ios/project.yml). Unset = APNs off. */
  APNS_BUNDLE_ID?: string;
  /** APNs host tried first: "production" (default) or "sandbox"; the other one is retried on BadDeviceToken. */
  APNS_ENVIRONMENT?: string;

  // secrets
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  CHECKER_TOKEN?: string;
  /** Firebase service-account key file (the whole JSON) for FCM HTTP v1; unset = no Android push. */
  FCM_SERVICE_ACCOUNT?: string;
  /** APNs token-based auth: Apple Developer team id, key id of the .p8 key, and the .p8 file's PEM contents. */
  APNS_TEAM_ID?: string;
  APNS_KEY_ID?: string;
  APNS_PRIVATE_KEY?: string;
}

export function trustedOrigins(env: Env): string[] {
  return (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
