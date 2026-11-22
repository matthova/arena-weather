/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291 / 8188),
 * implemented on WebCrypto only so it runs on Cloudflare Workers, Node 18+ and browsers.
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  /** base64url, 65-byte uncompressed P-256 public key */
  p256dh: string;
  /** base64url, 16-byte auth secret */
  auth: string;
}

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 public key */
  publicKey: string;
  /** base64url, 32-byte private scalar */
  privateKey: string;
  /** "mailto:..." or an https URL identifying the sender */
  subject: string;
}

export interface SendPushOptions {
  /** seconds the push service keeps the message. Default 4 hours. */
  ttl?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  topic?: string;
  fetch?: typeof fetch;
}

export interface SendPushResult {
  ok: boolean;
  status: number;
  /** 404/410 from the push service: the subscription is dead and should be deleted. */
  gone: boolean;
  body?: string;
}

// --- base64url helpers ---------------------------------------------------------

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(input: string): Uint8Array {
  const s = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const te = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function buf(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

type DeriveAlgorithm = Parameters<SubtleCrypto["deriveBits"]>[0];
/** ECDH parameters (typed loosely: Workers' types spell the `public` field differently). */
function ecdhParams(publicKey: CryptoKey): DeriveAlgorithm {
  return { name: "ECDH", public: publicKey } as unknown as DeriveAlgorithm;
}

async function generateEcKeyPair(algo: "ECDSA" | "ECDH", usages: string[]): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: algo, namedCurve: "P-256" },
    true,
    usages,
  )) as CryptoKeyPair;
}

// --- VAPID ---------------------------------------------------------------------

/** Generate a new VAPID key pair (same format `web-push generate-vapid-keys` prints). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await generateEcKeyPair("ECDSA", ["sign", "verify"]);
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
  if (!jwk.d) throw new Error("Failed to export VAPID private key");
  return { publicKey: b64urlEncode(raw), privateKey: jwk.d };
}

async function importVapidPrivateKey(keys: Pick<VapidKeys, "publicKey" | "privateKey">) {
  const pub = b64urlDecode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4)
    throw new Error("VAPID public key must be a 65-byte uncompressed P-256 point");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: keys.privateKey,
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
}

/** A signed VAPID JWT for `audience` (the push service origin), valid for 12 hours. */
export async function createVapidJwt(
  keys: VapidKeys,
  audience: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = b64urlEncode(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64urlEncode(
    te.encode(JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: keys.subject })),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importVapidPrivateKey(keys);
  // WebCrypto ECDSA signatures are already the raw r||s format JWS expects.
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    te.encode(signingInput),
  );
  return `${signingInput}.${b64urlEncode(sig)}`;
}

export async function vapidAuthorizationHeader(keys: VapidKeys, endpoint: string): Promise<string> {
  const audience = new URL(endpoint).origin;
  const jwt = await createVapidJwt(keys, audience);
  return `vapid t=${jwt}, k=${keys.publicKey}`;
}

// --- Payload encryption (RFC 8291, aes128gcm) --------------------------------------

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bits: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  const out = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) },
    key,
    bits,
  );
  return new Uint8Array(out);
}

export interface EncryptedPayload {
  body: Uint8Array;
  /** the ephemeral sender public key, for tests/debugging */
  senderPublicKey: Uint8Array;
  salt: Uint8Array;
}

/** Encrypt `plaintext` for a subscriber. `salt` / `senderKeyPair` are injectable for deterministic tests. */
export async function encryptPayload(
  subscription: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  plaintext: Uint8Array,
  opts: { salt?: Uint8Array; senderKeyPair?: CryptoKeyPair; paddingLength?: number } = {},
): Promise<EncryptedPayload> {
  const uaPublic = b64urlDecode(subscription.p256dh);
  const authSecret = b64urlDecode(subscription.auth);
  if (uaPublic.length !== 65) throw new Error("p256dh must be a 65-byte uncompressed P-256 point");
  if (authSecret.length !== 16) throw new Error("auth must be 16 bytes");

  const senderKeyPair = opts.senderKeyPair ?? (await generateEcKeyPair("ECDH", ["deriveBits"]));
  const senderPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", senderKeyPair.publicKey)) as ArrayBuffer,
  );
  const uaKey = await crypto.subtle.importKey(
    "raw",
    buf(uaPublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhParams(uaKey), senderKeyPair.privateKey, 256),
  );

  // IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info\0" || ua_public || as_public, 32)
  const keyInfo = concat(te.encode("WebPush: info\0"), uaPublic, senderPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 256);

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 96);

  // single record: plaintext || 0x02 || zero padding
  const padding = new Uint8Array(opts.paddingLength ?? 0);
  const record = concat(plaintext, new Uint8Array([2]), padding);
  const aesKey = await crypto.subtle.importKey("raw", buf(cek), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, aesKey, buf(record)),
  );

  // header: salt(16) || rs(4) || idlen(1) || keyid(65)
  // record size: the conventional 4096 (RFC 8291 test vector); our single record is always smaller
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  header.set(senderPublic, 21);

  return { body: concat(header, ciphertext), senderPublicKey: senderPublic, salt };
}

/** Decrypt an aes128gcm body with the subscriber's ECDH private key. Used by tests; handy for a debug tool. */
export async function decryptPayload(
  body: Uint8Array,
  subscriberPrivateKey: CryptoKey,
  subscriberPublicRaw: Uint8Array,
  authSecret: Uint8Array,
): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const idlen = body[20] ?? 0;
  const senderPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const senderKey = await crypto.subtle.importKey(
    "raw",
    buf(senderPublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhParams(senderKey), subscriberPrivateKey, 256),
  );
  const keyInfo = concat(te.encode("WebPush: info\0"), subscriberPublicRaw, senderPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 256);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 96);
  const aesKey = await crypto.subtle.importKey("raw", buf(cek), "AES-GCM", false, ["decrypt"]);
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(nonce) }, aesKey, buf(ciphertext)),
  );
  // strip padding delimiter (last 0x02 followed by zeros)
  let end = record.length - 1;
  while (end >= 0 && record[end] === 0) end--;
  if (record[end] !== 2) throw new Error("Invalid padding delimiter");
  return record.slice(0, end);
}

// --- Sending -------------------------------------------------------------------

/** Encrypt and POST one message to a subscription's push service. */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: string | Uint8Array,
  vapid: VapidKeys,
  options: SendPushOptions = {},
): Promise<SendPushResult> {
  const plaintext = typeof payload === "string" ? te.encode(payload) : payload;
  if (plaintext.length > 3993) throw new Error("Push payload must be at most 3993 bytes");
  const { body } = await encryptPayload(subscription, plaintext);
  const headers: Record<string, string> = {
    authorization: await vapidAuthorizationHeader(vapid, subscription.endpoint),
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(options.ttl ?? 4 * 3600),
    urgency: options.urgency ?? "normal",
  };
  if (options.topic) headers.topic = options.topic;
  const res = await (options.fetch ?? fetch)(subscription.endpoint, {
    method: "POST",
    headers,
    body: buf(body),
  });
  const text = res.ok ? undefined : await res.text().catch(() => undefined);
  return {
    ok: res.ok,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
    body: text,
  };
}
