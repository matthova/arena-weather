import { betterAuth } from "better-auth";
import { bearer, oneTimeToken } from "better-auth/plugins";
import { D1Dialect } from "kysely-d1";
import { type Env, trustedOrigins } from "./env.js";
import type { EmailSender } from "./lib/email.js";

export type Auth = ReturnType<typeof createAuth>;
export type Session = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

/**
 * Better Auth: e-mail + password (verification e-mail via Resend) and Google OAuth.
 * Google is only enabled when GOOGLE_CLIENT_ID/SECRET are set, so local dev works without them.
 */
export function createAuth(env: Env, email: EmailSender) {
  const appUrl = env.APP_URL.replace(/\/$/, "");
  const apiUrl = env.API_URL.replace(/\/$/, "");
  const crossSite = new URL(appUrl).host !== new URL(apiUrl).host;
  const secure = apiUrl.startsWith("https://");

  return betterAuth({
    appName: env.APP_NAME,
    baseURL: apiUrl,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    // Native clients: sign-in responses carry the session token in `set-auth-token`; they send it
    // back as `Authorization: Bearer <token>` instead of the cookie (web keeps using the cookie).
    // `oneTimeToken` hands a browser-flow (Google) session over to a native app: see routes/native.ts.
    plugins: [bearer(), oneTimeToken({ expiresIn: 3, storeToken: "hashed" })],
    database: { dialect: new D1Dialect({ database: env.DB }), type: "sqlite" },
    trustedOrigins: [appUrl, apiUrl, ...trustedOrigins(env)],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await email.send({
          to: user.email,
          subject: `${env.APP_NAME}: reset your password`,
          text: `Hi ${user.name || ""},\n\nReset your password here:\n${url}\n\nIf you did not ask for this, ignore this e-mail.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await email.send({
          to: user.email,
          subject: `${env.APP_NAME}: confirm your e-mail`,
          text: `Hi ${user.name || ""},\n\nConfirm your e-mail address to finish signing up:\n${url}\n\nIf you did not sign up, ignore this e-mail.`,
        });
      },
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              // Better Auth redirects back to <API_URL>/api/auth/callback/google, then to callbackURL
            },
          }
        : {},
    advanced: {
      // The web app and the API are different hosts (e.g. app.example.com / api.example.com):
      // cookies must be SameSite=None; Secure for the browser to send them cross-site. Over plain
      // http (local dev) that is impossible, so the web dev server should proxy /api to the worker.
      defaultCookieAttributes: crossSite && secure ? { sameSite: "none", secure: true } : undefined,
      useSecureCookies: secure,
    },
  });
}
