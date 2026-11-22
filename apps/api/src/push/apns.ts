/**
 * Apple Push Notification service (APNs) over its HTTP/2 provider API with token-based
 * authentication (a .p8 key, ES256 JWT), on WebCrypto + fetch only so it runs on Cloudflare Workers.
 * https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
 */

import type { PushMessage } from "./sender.js";
import { b64urlEncode, type SendPushResult } from "./webpush.js";

export type ApnsEnvironment = "production" | "sandbox";

export interface ApnsConfig {
  /** Apple Developer team id (10 chars). */
  teamId: string;
  /** Key id of the .p8 APNs auth key (10 chars). */
  keyId: string;
  /** The .p8 file contents (PEM, `-----BEGIN PRIVATE KEY-----`, PKCS#8, P-256). */
  privateKey: string;
  /** The app's bundle id = APNs topic. */
  bundleId: string;
  /** Host for tokens registered without an environment. Default "production". */
  defaultEnvironment?: ApnsEnvironment;
}

export interface ApnsTarget {
  /** Hex device token as `UIApplication` hands it over (64 hex chars for current devices). */
  token: string;
  /** Force a host; otherwise the configured default, with a one-time retry on the other host (see `sendApns`). */
  environment?: ApnsEnvironment | null;
}

export const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

export function parseApnsEnvironment(
  value: string | null | undefined,
): ApnsEnvironment | undefined {
  return value === "production" || value === "sandbox" ? value : undefined;
}

export function apnsRequestUrl(target: ApnsTarget, config: Pick<ApnsConfig, "defaultEnvironment">) {
  const environment = target.environment ?? config.defaultEnvironment ?? "production";
  return `${APNS_HOSTS[environment]}/3/device/${target.token}`;
}

const te = new TextEncoder();

/** `-----BEGIN PRIVATE KEY-----` PEM → PKCS#8 DER bytes. Tolerates \n escaped as literal "\n" (wrangler secrets pasted on one line). */
export function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!body) throw new Error("APNS_PRIVATE_KEY is empty or not PEM");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importApnsKey(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** A provider token: ES256 JWS with `kid` in the header and `iss` (team id) + `iat` in the claims. */
export async function createApnsJwt(
  key: CryptoKey,
  ids: Pick<ApnsConfig, "teamId" | "keyId">,
  issuedAt = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = b64urlEncode(te.encode(JSON.stringify({ alg: "ES256", kid: ids.keyId })));
  const payload = b64urlEncode(te.encode(JSON.stringify({ iss: ids.teamId, iat: issuedAt })));
  const input = `${header}.${payload}`;
  // WebCrypto ECDSA signatures are the raw r||s JOSE expects (not DER).
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(input));
  return `${input}.${b64urlEncode(sig)}`;
}

/** Apple wants the provider token refreshed no more than once every 20 minutes and at least every hour. */
export const APNS_TOKEN_LIFETIME_SECONDS = 50 * 60;

export interface ApnsTokenProvider {
  token(now?: number): Promise<string>;
  /** Forget the cached token (after `ExpiredProviderToken`). */
  invalidate(): void;
}

export function createApnsTokenProvider(
  config: Pick<ApnsConfig, "teamId" | "keyId" | "privateKey">,
  lifetimeSeconds = APNS_TOKEN_LIFETIME_SECONDS,
): ApnsTokenProvider {
  let key: Promise<CryptoKey> | null = null;
  let cached: { jwt: string; issuedAt: number } | null = null;
  return {
    async token(now = Math.floor(Date.now() / 1000)) {
      if (cached && now - cached.issuedAt < lifetimeSeconds) return cached.jwt;
      key ??= importApnsKey(config.privateKey);
      const jwt = await createApnsJwt(await key, config, now);
      cached = { jwt, issuedAt: now };
      return jwt;
    },
    invalidate() {
      cached = null;
    },
  };
}

/** The APNs payload for a notification: a visible alert plus the same custom fields the web payload carries. */
export function apnsPayload(message: PushMessage): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    alert: { title: message.title, body: message.body },
    sound: "default",
  };
  if (message.tag) aps["thread-id"] = message.tag;
  return {
    aps,
    ...(message.url ? { url: message.url } : {}),
    ...(message.tag ? { tag: message.tag } : {}),
    ...(message.data ? { data: message.data } : {}),
  };
}

/** APNs statuses/reasons after which the device token should be deleted. */
export function apnsTokenIsGone(status: number, reason: string | undefined): boolean {
  if (status === 410) return true; // Unregistered
  return (
    status === 400 &&
    (reason === "BadDeviceToken" ||
      reason === "DeviceTokenNotForTopic" ||
      reason === "Unregistered")
  );
}

export interface SendApnsOptions {
  fetch?: typeof fetch;
  tokenProvider?: ApnsTokenProvider;
  /** seconds APNs keeps the notification for an offline device. Default 4 hours. */
  ttl?: number;
  now?: number;
  /** Retry on the other APNs host after BadDeviceToken (default true). */
  fallbackEnvironment?: boolean;
}

/** POST one notification to APNs. Resolves (never throws) for HTTP-level outcomes; network errors propagate. */
export async function sendApns(
  target: ApnsTarget,
  message: PushMessage,
  config: ApnsConfig,
  opts: SendApnsOptions = {},
): Promise<SendPushResult> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const tokens = opts.tokenProvider ?? createApnsTokenProvider(config);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify(apnsPayload(message));
  if (te.encode(body).length > 4096)
    return { ok: false, status: 0, gone: false, body: "APNs payload exceeds 4 KB" };

  const attempt = async (to: ApnsTarget): Promise<SendPushResult & { reason?: string }> => {
    const headers: Record<string, string> = {
      authorization: `bearer ${await tokens.token(now)}`,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(now + (opts.ttl ?? 4 * 3600)),
      "content-type": "application/json",
    };
    if (message.tag) headers["apns-collapse-id"] = message.tag.slice(0, 64);
    const res = await fetchImpl(apnsRequestUrl(to, config), { method: "POST", headers, body });
    const text = await res.text().catch(() => "");
    let reason: string | undefined;
    if (text) {
      try {
        reason = (JSON.parse(text) as { reason?: string }).reason;
      } catch {
        /* not JSON */
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      gone: apnsTokenIsGone(res.status, reason),
      body: text || undefined,
      reason,
    };
  };

  let result = await attempt(target);
  if (result.status === 403 && result.reason === "ExpiredProviderToken") {
    tokens.invalidate();
    result = await attempt(target);
  }
  // Tokens are stored without their environment (one row shape for every channel). A debug build's
  // sandbox token answered on the production host is "BadDeviceToken" (and vice versa): try the
  // other host once before declaring the token dead.
  if (
    !target.environment &&
    result.status === 400 &&
    result.reason === "BadDeviceToken" &&
    opts.fallbackEnvironment !== false
  ) {
    const first = target.environment ?? config.defaultEnvironment ?? "production";
    const other: ApnsEnvironment = first === "production" ? "sandbox" : "production";
    const retry = await attempt({ token: target.token, environment: other });
    if (retry.ok || !retry.gone) return retry;
  }
  return result;
}
