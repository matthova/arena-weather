/**
 * Firebase Cloud Messaging, HTTP v1 API, on WebCrypto only (runs on Cloudflare Workers).
 *
 * Authentication is a Google service account: we mint an RS256 JWT with the account's private key,
 * exchange it for an OAuth 2.0 access token at the token endpoint (RFC 7523), cache that token until
 * shortly before it expires, and POST messages to
 * https://fcm.googleapis.com/v1/projects/<project>/messages:send.
 *
 * https://firebase.google.com/docs/cloud-messaging/send-message
 * https://developers.google.com/identity/protocols/oauth2/service-account
 */

import type { PushMessage } from "./sender.js";
import { b64urlEncode } from "./webpush.js";

/** The fields of a Firebase service-account JSON key file that FCM needs. */
export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  /** PEM, "-----BEGIN PRIVATE KEY-----" (PKCS#8) */
  private_key: string;
  /** Defaults to https://oauth2.googleapis.com/token */
  token_uri?: string;
}

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

export interface FcmSendResult {
  ok: boolean;
  status: number;
  /** The token is no longer valid (UNREGISTERED / invalid registration): delete the device. */
  gone: boolean;
  body?: string;
  /** FCM's message name on success, "projects/<p>/messages/<id>" */
  messageId?: string;
}

/** Parse the JSON of a service-account key file; throws a readable error for the common mistakes. */
export function parseServiceAccount(json: string): FcmServiceAccount {
  let parsed: Partial<FcmServiceAccount>;
  try {
    parsed = JSON.parse(json) as Partial<FcmServiceAccount>;
  } catch {
    throw new Error("FCM_SERVICE_ACCOUNT is not valid JSON");
  }
  for (const k of ["project_id", "client_email", "private_key"] as const) {
    if (typeof parsed[k] !== "string" || !parsed[k])
      throw new Error(`FCM_SERVICE_ACCOUNT is missing "${k}"`);
  }
  return {
    project_id: parsed.project_id as string,
    client_email: parsed.client_email as string,
    private_key: parsed.private_key as string,
    token_uri: parsed.token_uri,
  };
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

const te = new TextEncoder();

async function importRsaKey(pem: string): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(pem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (e) {
    throw new Error(
      `FCM service-account private key could not be imported (expected PKCS#8 PEM): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** The signed JWT assertion that is exchanged for an access token (RS256, 1 hour). */
export async function createServiceAccountJwt(
  account: FcmServiceAccount,
  scope: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = b64urlEncode(te.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64urlEncode(
    te.encode(
      JSON.stringify({
        iss: account.client_email,
        scope,
        aud: account.token_uri ?? DEFAULT_TOKEN_URI,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importRsaKey(account.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, te.encode(signingInput));
  return `${signingInput}.${b64urlEncode(sig)}`;
}

export interface AccessToken {
  token: string;
  /** unix seconds */
  expiresAt: number;
}

/** JWT bearer grant: assertion -> access token. */
export async function fetchAccessToken(
  account: FcmServiceAccount,
  fetchImpl: typeof fetch = fetch,
  now = Math.floor(Date.now() / 1000),
): Promise<AccessToken> {
  const assertion = await createServiceAccountJwt(account, FCM_SCOPE, now);
  const res = await fetchImpl(account.token_uri ?? DEFAULT_TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token endpoint answered ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google token endpoint returned no access_token");
  return { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
}

/**
 * An access-token cache: one token per sender, refreshed 60 s before expiry; concurrent callers share
 * one in-flight exchange.
 */
export function createTokenSource(
  account: FcmServiceAccount,
  fetchImpl: typeof fetch = fetch,
  clock: () => number = () => Math.floor(Date.now() / 1000),
) {
  let cached: AccessToken | null = null;
  let inflight: Promise<AccessToken> | null = null;
  return {
    async get(): Promise<string> {
      const now = clock();
      if (cached && cached.expiresAt - 60 > now) return cached.token;
      if (!inflight) {
        inflight = fetchAccessToken(account, fetchImpl, now).finally(() => {
          inflight = null;
        });
      }
      cached = await inflight;
      return cached.token;
    },
    /** Drop the cached token (after a 401 from FCM). */
    invalidate() {
      cached = null;
    },
  };
}

/** The FCM v1 message for one device: a notification plus the same payload the web client gets, as data. */
export function buildFcmMessage(deviceToken: string, message: PushMessage) {
  const data: Record<string, string> = { title: message.title, body: message.body };
  if (message.url) data.url = message.url;
  if (message.tag) data.tag = message.tag;
  if (message.data) {
    for (const [k, v] of Object.entries(message.data)) {
      // FCM data values must be strings
      data[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  const collapseKey = message.tag ? message.tag.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64) : "";
  return {
    message: {
      token: deviceToken,
      notification: { title: message.title, body: message.body },
      data,
      android: {
        priority: "HIGH" as const,
        ttl: "14400s",
        ...(collapseKey ? { collapse_key: collapseKey } : {}),
        // no click_action: the launcher activity opens with the data fields as intent extras
        notification: {
          channel_id: "weather_alerts",
          ...(collapseKey ? { tag: collapseKey } : {}),
        },
      },
    },
  };
}

/**
 * Whether an FCM error response means the device token is dead. UNREGISTERED is the normal case
 * (app uninstalled, token rotated); a 400 INVALID_ARGUMENT naming the token is treated the same.
 */
export function isTokenGone(status: number, body: string | undefined): boolean {
  if (status === 404) return true;
  if (!body) return false;
  if (/UNREGISTERED/.test(body)) return true;
  if (status === 400 && /INVALID_ARGUMENT/.test(body) && /registration token|token/i.test(body))
    return true;
  return false;
}

export interface FcmSender {
  readonly enabled: boolean;
  readonly projectId: string | null;
  send(deviceToken: string, message: PushMessage): Promise<FcmSendResult>;
}

export interface FcmSenderOptions {
  fetch?: typeof fetch;
  clock?: () => number;
  endpoint?: (projectId: string) => string;
}

/** Sender over a service account; `enabled` is false when the secret is unset or unusable. */
export function createFcmSender(
  serviceAccountJson: string | undefined,
  options: FcmSenderOptions = {},
): FcmSender {
  const fetchImpl = options.fetch ?? fetch;
  let account: FcmServiceAccount | null = null;
  let configError: string | null = null;
  if (serviceAccountJson?.trim()) {
    try {
      account = parseServiceAccount(serviceAccountJson);
    } catch (e) {
      configError = e instanceof Error ? e.message : String(e);
      console.error(`FCM disabled: ${configError}`);
    }
  }
  const tokens = account ? createTokenSource(account, fetchImpl, options.clock) : null;
  const url = account
    ? (options.endpoint?.(account.project_id) ??
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`)
    : null;

  return {
    enabled: Boolean(account),
    projectId: account?.project_id ?? null,
    async send(deviceToken, message) {
      if (!account || !tokens || !url) {
        return {
          ok: false,
          status: 0,
          gone: false,
          body: configError ?? "FCM_SERVICE_ACCOUNT not configured",
        };
      }
      const post = async (): Promise<Response> =>
        fetchImpl(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${await tokens.get()}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(buildFcmMessage(deviceToken, message)),
        });
      let res = await post();
      if (res.status === 401) {
        // the cached token was revoked or expired early: refresh once and retry
        tokens.invalidate();
        res = await post();
      }
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { name?: string };
        return { ok: true, status: res.status, gone: false, messageId: data.name };
      }
      const body = await res.text().catch(() => undefined);
      return { ok: false, status: res.status, gone: isTokenGone(res.status, body), body };
    },
  };
}
