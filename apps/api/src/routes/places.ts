import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { badRequest } from "../lib/http.js";

const query = z.object({
  q: z.string().trim().min(1).max(100),
  count: z.coerce.number().int().min(1).max(50).optional(),
  language: z.string().trim().min(2).max(10).optional(),
});

export const placesRoutes = new Hono<AppEnv>().get(
  "/search",
  zValidator("query", query, (r) => {
    if (!r.success) throw badRequest("Invalid query", r.error.issues);
  }),
  async (c) => {
    const { q, count, language } = c.req.valid("query");
    const results = await c.get("services").provider.geocode({ query: q, count, language });
    return c.json({ results });
  },
);
