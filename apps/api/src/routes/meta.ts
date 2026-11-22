import { VARIABLES } from "@arena-weather/core";
import { Hono } from "hono";
import type { AppEnv } from "../app.js";

export const metaRoutes = new Hono<AppEnv>()
  .get("/health", (c) =>
    c.json({ ok: true as const, version: "0.1.0", time: new Date().toISOString() }),
  )
  .get("/variables", (c) => c.json({ variables: VARIABLES }))
  .get("/me", (c) => {
    const session = c.get("session");
    return c.json({ user: session?.user ?? null });
  });
