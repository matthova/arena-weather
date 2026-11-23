import { VARIABLES } from "@arena-weather/core";
import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { devMailboxEnabled, devOutbox } from "../lib/email.js";
import { notFound } from "../lib/http.js";

export const metaRoutes = new Hono<AppEnv>()
  .get("/health", (c) =>
    c.json({ ok: true as const, version: "0.1.0", time: new Date().toISOString() }),
  )
  /** What this deployment offers, so clients can hide what is not configured. */
  .get("/config", (c) => {
    const env = c.env;
    return c.json({
      appName: env.APP_NAME,
      /** Public origin of the web app: native clients use it as the callbackURL of e-mail links. */
      appUrl: env.APP_URL,
      googleSignIn: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      push: c.get("services").push.enabled,
      /** Native push channels this deployment can deliver to (secrets configured). */
      pushChannels: { fcm: c.get("services").fcm.enabled, apns: c.get("services").apns.enabled },
      devMailbox: devMailboxEnabled(env),
    });
  })
  .get("/variables", (c) => c.json({ variables: VARIABLES }))
  .get("/me", (c) => {
    const session = c.get("session");
    return c.json({ user: session?.user ?? null });
  })
  /** Local development only: the e-mails that would have been sent (verification links etc.). */
  .get("/dev/outbox", (c) => {
    if (!devMailboxEnabled(c.env)) throw notFound();
    const to = c.req.query("to")?.trim().toLowerCase();
    const messages = devOutbox.filter((m) => !to || m.to.toLowerCase() === to);
    return c.json({ messages });
  });
