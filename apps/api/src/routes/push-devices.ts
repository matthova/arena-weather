import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { createPushDevices, NATIVE_PUSH_CHANNELS } from "../db/push-devices.js";
import { badRequest, notFound } from "../lib/http.js";
import { requireAuth } from "../middleware.js";

/**
 * Native push registration: `POST /api/push/devices { channel: "fcm" | "apns", token, userAgent? }`.
 * Idempotent by token (re-registering after a token refresh just moves the row); the row then
 * receives everything the user's web push subscriptions receive. `DELETE` forgets the token
 * (on sign-out, or when the platform reports it invalid).
 */
const deviceSchema = z.object({
  channel: z.enum(NATIVE_PUSH_CHANNELS),
  token: z.string().trim().min(16).max(4096),
  userAgent: z.string().max(500).optional(),
});

const onInvalid = (r: { success: boolean; error?: { issues: unknown } }) => {
  if (!r.success) throw badRequest("Invalid body", r.error?.issues);
};

export const pushDeviceRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .post("/", zValidator("json", deviceSchema, onInvalid), async (c) => {
    const { channel, token, userAgent } = c.req.valid("json");
    const row = await createPushDevices(c.env.DB).upsert(
      c.get("userId"),
      { channel, token },
      userAgent ?? c.req.header("user-agent") ?? null,
    );
    return c.json(
      {
        device: {
          id: row.id,
          channel: row.channel,
          token: row.endpoint,
          createdAt: row.createdAt,
          userAgent: row.userAgent,
        },
        /** Whether the API can actually deliver on this channel (the matching secret is configured). */
        deliverable:
          channel === "fcm" ? c.get("services").fcm.enabled : c.get("services").apns.enabled,
      },
      201,
    );
  })
  .delete(
    "/",
    zValidator("json", z.object({ token: z.string().trim().min(1).max(4096) }), onInvalid),
    async (c) => {
      const ok = await createPushDevices(c.env.DB).deleteByToken(
        c.get("userId"),
        c.req.valid("json").token,
      );
      if (!ok) throw notFound("Device");
      return c.body(null, 204);
    },
  );
