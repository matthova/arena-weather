import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { ApiError, badRequest, notFound } from "../lib/http.js";
import { requireAuth } from "../middleware.js";

const subscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.url().max(2000),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().min(80).max(120), auth: z.string().min(16).max(32) }),
  }),
  userAgent: z.string().max(500).optional(),
});

const onInvalid = (r: { success: boolean; error?: { issues: unknown } }) => {
  if (!r.success) throw badRequest("Invalid body", r.error?.issues);
};

const publicSub = (s: {
  id: string;
  channel: string;
  endpoint: string;
  createdAt: string;
  userAgent: string | null;
}) => ({
  id: s.id,
  channel: s.channel,
  endpoint: s.endpoint,
  createdAt: s.createdAt,
  userAgent: s.userAgent,
});

export const pushRoutes = new Hono<AppEnv>()
  /** The VAPID public key the browser needs for pushManager.subscribe({ applicationServerKey }). */
  .get("/public-key", (c) => {
    const key = c.get("services").push.publicKey;
    if (!key)
      throw new ApiError(
        503,
        "push_not_configured",
        "Web push is not configured (VAPID keys missing)",
      );
    return c.json({ publicKey: key });
  })
  .use("*", requireAuth)
  .get("/subscriptions", async (c) => {
    const subs = await c.get("services").repo.push.listByUser(c.get("userId"));
    return c.json({ subscriptions: subs.map(publicSub) });
  })
  .post("/subscriptions", zValidator("json", subscriptionSchema, onInvalid), async (c) => {
    const { subscription, userAgent } = c.req.valid("json");
    const row = await c.get("services").repo.push.upsert(
      c.get("userId"),
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expirationTime: subscription.expirationTime ?? null,
      },
      userAgent ?? c.req.header("user-agent") ?? null,
    );
    return c.json({ subscription: publicSub(row) }, 201);
  })
  .delete(
    "/subscriptions",
    zValidator("json", z.object({ endpoint: z.url() }), onInvalid),
    async (c) => {
      const ok = await c
        .get("services")
        .repo.push.deleteByEndpoint(c.get("userId"), c.req.valid("json").endpoint);
      if (!ok) throw notFound("Subscription");
      return c.body(null, 204);
    },
  );
