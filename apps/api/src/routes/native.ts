import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { ApiError, badRequest, unauthorized } from "../lib/http.js";

/** Custom URL schemes native apps may be handed a one-time token on (comma-separated var). */
export function nativeRedirectSchemes(env: { NATIVE_REDIRECT_SCHEMES?: string }): string[] {
  return (env.NATIVE_REDIRECT_SCHEMES ?? "weatheralerts")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/:.*$/, ""))
    .filter(Boolean);
}

/**
 * Browser-flow sign-in (Google) for native apps. The app opens Better Auth's `sign-in/social` URL in
 * an in-app browser (ASWebAuthenticationSession / Custom Tabs) with
 * `callbackURL = <API_URL>/api/native/handoff?redirect=<scheme>://auth/callback`. When Google's
 * callback has signed the browser in, this route turns that cookie session into a one-time token and
 * redirects to the app, which exchanges it at `POST /api/auth/one-time-token/verify` for a bearer
 * session (`set-auth-token`). Only allow-listed app schemes may receive the token (no open redirect).
 */
export const nativeRoutes = new Hono<AppEnv>().get("/handoff", async (c) => {
  const redirect = c.req.query("redirect");
  if (!redirect) throw badRequest("redirect is required");
  let target: URL;
  try {
    target = new URL(redirect);
  } catch {
    throw badRequest("redirect must be an absolute URL");
  }
  const scheme = target.protocol.replace(/:$/, "").toLowerCase();
  if (!nativeRedirectSchemes(c.env).includes(scheme))
    throw new ApiError(400, "bad_request", `redirect scheme "${scheme}" is not allowed`);
  if (!c.get("session")) throw unauthorized();
  const { token } = await c
    .get("services")
    .auth.api.generateOneTimeToken({ headers: c.req.raw.headers });
  target.searchParams.set("ott", token);
  return c.redirect(target.toString(), 302);
});
