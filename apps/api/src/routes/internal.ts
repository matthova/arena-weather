import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { runChecker } from "../checker.js";
import { ApiError } from "../lib/http.js";

/** Manual trigger of the cron job (for local dev and ops). Needs CHECKER_TOKEN as a bearer token. */
export const internalRoutes = new Hono<AppEnv>().post("/run-checker", async (c) => {
  const token = c.env.CHECKER_TOKEN;
  const given = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || given !== token) throw new ApiError(403, "forbidden", "Invalid checker token");
  const summary = await runChecker(c.get("services"));
  return c.json(summary);
});
