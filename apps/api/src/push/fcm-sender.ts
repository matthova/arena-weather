import type { Env } from "../env.js";
import { createFcmSender, type FcmSender } from "./fcm.js";

export type { FcmSender } from "./fcm.js";

/** The FCM sender for a Worker env: reads the service-account JSON from the FCM_SERVICE_ACCOUNT secret. */
export function fcmSenderFromEnv(
  env: Pick<Env, "FCM_SERVICE_ACCOUNT">,
  fetchImpl?: typeof fetch,
): FcmSender {
  return createFcmSender(env.FCM_SERVICE_ACCOUNT, { fetch: fetchImpl });
}
