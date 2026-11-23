import { DAILY_VARIABLE_NAMES, HOURLY_VARIABLE_NAMES } from "@arena-weather/core";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { badRequest } from "../lib/http.js";
import { DEFAULT_CURRENT, DEFAULT_DAILY, DEFAULT_HOURLY } from "../providers/forecast.js";

const list = (allowed: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : [],
    )
    .refine((vs) => vs.every((v) => allowed.includes(v)), { message: "Unknown variable" });

const query = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  timezone: z.string().trim().min(1).max(100).optional(),
  hourly: list(HOURLY_VARIABLE_NAMES),
  daily: list(DAILY_VARIABLE_NAMES),
});

/** Current conditions + hourly for the next 24 h (we return 2 days and the client slices) + 7 daily. */
export const forecastRoutes = new Hono<AppEnv>().get(
  "/",
  zValidator("query", query, (r) => {
    if (!r.success) throw badRequest("Invalid query", r.error.issues);
  }),
  async (c) => {
    const q = c.req.valid("query");
    const forecast = await c.get("services").provider.forecast({
      latitude: q.latitude,
      longitude: q.longitude,
      timezone: q.timezone,
      current: DEFAULT_CURRENT,
      hourly: [...new Set([...DEFAULT_HOURLY, ...q.hourly])],
      daily: [...new Set([...DEFAULT_DAILY, ...q.daily])],
      forecastDays: 7,
    });
    c.header("cache-control", "public, max-age=300");
    return c.json(forecast);
  },
);
