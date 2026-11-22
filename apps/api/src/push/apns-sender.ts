import type { Env } from "../env.js";
import {
  type ApnsConfig,
  type ApnsTokenProvider,
  createApnsTokenProvider,
  parseApnsEnvironment,
  sendApns,
} from "./apns.js";
import type { PushMessage } from "./sender.js";
import type { SendPushResult } from "./webpush.js";

/** Apple Push Notification service for iOS/macOS devices (channel "apns"). */
export interface ApnsSender {
  /** The APNs key, team id, key id and bundle id are all configured. */
  readonly enabled: boolean;
  readonly bundleId: string | null;
  send(deviceToken: string, message: PushMessage): Promise<SendPushResult>;
}

export function apnsConfigFromEnv(
  env: Pick<
    Env,
    "APNS_TEAM_ID" | "APNS_KEY_ID" | "APNS_PRIVATE_KEY" | "APNS_BUNDLE_ID" | "APNS_ENVIRONMENT"
  >,
): ApnsConfig | null {
  if (!env.APNS_TEAM_ID || !env.APNS_KEY_ID || !env.APNS_PRIVATE_KEY || !env.APNS_BUNDLE_ID)
    return null;
  return {
    teamId: env.APNS_TEAM_ID,
    keyId: env.APNS_KEY_ID,
    privateKey: env.APNS_PRIVATE_KEY,
    bundleId: env.APNS_BUNDLE_ID,
    defaultEnvironment: parseApnsEnvironment(env.APNS_ENVIRONMENT) ?? "production",
  };
}

/** Sender over the .p8 key in the APNS_* secrets; `enabled` is false when any of them is unset. */
export function createApnsSender(config: ApnsConfig | null, fetchImpl?: typeof fetch): ApnsSender {
  // One provider token per isolate: Apple asks for at most one refresh every 20 minutes.
  let tokens: ApnsTokenProvider | null = null;
  return {
    enabled: Boolean(config),
    bundleId: config?.bundleId ?? null,
    async send(deviceToken, message) {
      if (!config) return { ok: false, status: 0, gone: false, body: "APNs not configured" };
      tokens ??= createApnsTokenProvider(config);
      return sendApns({ token: deviceToken }, message, config, {
        fetch: fetchImpl,
        tokenProvider: tokens,
      });
    },
  };
}

export function apnsSenderFromEnv(
  env: Parameters<typeof apnsConfigFromEnv>[0],
  fetchImpl?: typeof fetch,
): ApnsSender {
  return createApnsSender(apnsConfigFromEnv(env), fetchImpl);
}
