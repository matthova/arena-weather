import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./app.js";
import { unauthorized } from "./lib/http.js";

type Authed = AppEnv & { Variables: AppEnv["Variables"] & { userId: string } };

/** Rejects requests without a session and exposes `userId`. */
export const requireAuth = createMiddleware<Authed>(async (c, next) => {
  const session = c.get("session");
  if (!session) throw unauthorized();
  c.set("userId", session.user.id);
  await next();
});
