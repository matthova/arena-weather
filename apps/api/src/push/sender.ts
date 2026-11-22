import type { Env } from "../env.js";
import { type PushSubscriptionKeys, type SendPushResult, sendWebPush } from "./webpush.js";

export interface PushMessage {
  title: string;
  body: string;
  /** URL the notification opens */
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

export interface PushSender {
  /** Whether VAPID keys are configured; without them nothing can be sent. */
  readonly enabled: boolean;
  readonly publicKey: string | null;
  send(subscription: PushSubscriptionKeys, message: PushMessage): Promise<SendPushResult>;
}

export function createPushSender(
  env: Pick<Env, "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT">,
  fetchImpl?: typeof fetch,
): PushSender {
  const enabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  return {
    enabled,
    publicKey: env.VAPID_PUBLIC_KEY ?? null,
    async send(subscription, message) {
      if (!enabled || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
        return { ok: false, status: 0, gone: false, body: "VAPID keys not configured" };
      }
      return sendWebPush(
        subscription,
        JSON.stringify(message),
        {
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: env.VAPID_SUBJECT || "mailto:alerts@example.com",
        },
        { fetch: fetchImpl, topic: message.tag },
      );
    },
  };
}
