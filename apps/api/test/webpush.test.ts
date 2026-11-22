import { describe, expect, it } from "vitest";
import { createPushSender } from "../src/push/sender.js";
import {
  b64urlDecode,
  b64urlEncode,
  createVapidJwt,
  decryptPayload,
  encryptPayload,
  generateVapidKeys,
  pushTopic,
  sendWebPush,
} from "../src/push/webpush.js";

/** What a browser does in pushManager.subscribe(): an ECDH P-256 key pair plus a 16-byte auth secret. */
async function fakeBrowserSubscription(endpoint = "https://push.example/v1/abc") {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    pair,
    publicRaw,
    auth,
    subscription: { endpoint, p256dh: b64urlEncode(publicRaw), auth: b64urlEncode(auth) },
  };
}

describe("web push on WebCrypto (runs inside workerd)", () => {
  it("base64url round-trips", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(33));
    expect(b64urlDecode(b64urlEncode(bytes))).toEqual(bytes);
    expect(b64urlEncode(new Uint8Array([251, 255]))).toBe("-_8");
  });

  it("generates VAPID keys in the standard format", async () => {
    const keys = await generateVapidKeys();
    expect(b64urlDecode(keys.publicKey)).toHaveLength(65);
    expect(b64urlDecode(keys.privateKey)).toHaveLength(32);
  });

  it("signs a VAPID JWT that verifies with the public key", async () => {
    const keys = { ...(await generateVapidKeys()), subject: "mailto:alerts@example.com" };
    const jwt = await createVapidJwt(keys, "https://push.example", 1_700_000_000);
    const [h, p, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(p)))).toEqual({
      aud: "https://push.example",
      exp: 1_700_000_000 + 12 * 3600,
      sub: "mailto:alerts@example.com",
    });
    const pub = await crypto.subtle.importKey(
      "raw",
      b64urlDecode(keys.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
    expect(b64urlDecode(s)).toHaveLength(64); // raw r||s, not DER
  });

  it("encrypts a payload the subscriber can decrypt (RFC 8291 aes128gcm)", async () => {
    const browser = await fakeBrowserSubscription();
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ title: "Rain", body: "80% at 17:00" }),
    );
    const { body, salt, senderPublicKey } = await encryptPayload(browser.subscription, plaintext, {
      paddingLength: 7,
    });
    // header layout: salt(16) rs(4) idlen(1) key(65) then ciphertext (+16 tag)
    expect(body.slice(0, 16)).toEqual(salt);
    expect(body[20]).toBe(65);
    expect(body.slice(21, 86)).toEqual(senderPublicKey);
    expect(body.length).toBe(86 + plaintext.length + 1 + 7 + 16);
    const decrypted = await decryptPayload(
      body,
      browser.pair.privateKey,
      browser.publicRaw,
      browser.auth,
    );
    expect(new TextDecoder().decode(decrypted)).toBe(new TextDecoder().decode(plaintext));
  });

  it("matches the RFC 8291 appendix A test vector", async () => {
    // https://www.rfc-editor.org/rfc/rfc8291#appendix-A
    const asPublicB64 =
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    const jwkFor = (publicB64: string, d: string) => {
      const pub = b64urlDecode(publicB64);
      return {
        kty: "EC",
        crv: "P-256",
        x: b64urlEncode(pub.slice(1, 33)),
        y: b64urlEncode(pub.slice(33, 65)),
        d,
      };
    };
    const uaPublic =
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    const auth = "BTBZMqHH6r4Tts7J_aSIgg";
    const salt = b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw");
    const plaintext = new TextEncoder().encode("When I grow up, I want to be a watermelon");
    const uaPrivateJwk = jwkFor(uaPublic, "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94");
    const asPrivateJwk = jwkFor(asPublicB64, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw");
    const uaPrivate = await crypto.subtle.importKey(
      "jwk",
      uaPrivateJwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    const asPrivate = await crypto.subtle.importKey(
      "jwk",
      asPrivateJwk,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const asPublic = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: asPrivateJwk.x, y: asPrivateJwk.y },
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    );
    const { body } = await encryptPayload({ p256dh: uaPublic, auth }, plaintext, {
      salt,
      senderKeyPair: { privateKey: asPrivate, publicKey: asPublic },
    });
    expect(b64urlEncode(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
    const decrypted = await decryptPayload(
      body,
      uaPrivate,
      b64urlDecode(uaPublic),
      b64urlDecode(auth),
    );
    expect(new TextDecoder().decode(decrypted)).toBe("When I grow up, I want to be a watermelon");
  });

  it("sendWebPush posts an encrypted body with VAPID and aes128gcm headers; 410 marks the subscription gone", async () => {
    const browser = await fakeBrowserSubscription();
    const vapid = { ...(await generateVapidKeys()), subject: "mailto:alerts@example.com" };
    const seen: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: seen.length === 1 ? 201 : 410 });
    }) as typeof fetch;
    const r1 = await sendWebPush(browser.subscription, "hello", vapid, {
      fetch: fakeFetch,
      ttl: 60,
      topic: "t1",
    });
    expect(r1).toMatchObject({ ok: true, status: 201, gone: false });
    const headers = seen[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`),
    );
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.ttl).toBe("60");
    expect(headers.topic).toBe("t1");
    const body = new Uint8Array(seen[0]?.init.body as ArrayBuffer);
    const decrypted = await decryptPayload(
      body,
      browser.pair.privateKey,
      browser.publicRaw,
      browser.auth,
    );
    expect(new TextDecoder().decode(decrypted)).toBe("hello");

    const r2 = await sendWebPush(browser.subscription, "again", vapid, { fetch: fakeFetch });
    expect(r2).toMatchObject({ ok: false, status: 410, gone: true });
  });

  it("createPushSender is disabled without VAPID keys and sends JSON messages with them", async () => {
    const off = createPushSender({ VAPID_SUBJECT: "mailto:x@example.com" });
    expect(off.enabled).toBe(false);
    expect(
      (await off.send({ endpoint: "https://x", p256dh: "", auth: "" }, { title: "t", body: "b" }))
        .ok,
    ).toBe(false);

    const keys = await generateVapidKeys();
    const browser = await fakeBrowserSubscription();
    let captured: Uint8Array | null = null;
    const on = createPushSender(
      {
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: "mailto:x@example.com",
      },
      (async (_url: RequestInfo | URL, init?: RequestInit) => {
        captured = new Uint8Array(init?.body as ArrayBuffer);
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    );
    expect(on.enabled).toBe(true);
    expect(on.publicKey).toBe(keys.publicKey);
    const r = await on.send(browser.subscription, { title: "Rain", body: "soon", url: "/rules/1" });
    expect(r.ok).toBe(true);
    const decrypted = await decryptPayload(
      captured as unknown as Uint8Array,
      browser.pair.privateKey,
      browser.publicRaw,
      browser.auth,
    );
    expect(JSON.parse(new TextDecoder().decode(decrypted))).toEqual({
      title: "Rain",
      body: "soon",
      url: "/rules/1",
    });
  });
});

describe("pushTopic", () => {
  it("keeps short base64url tags as they are", () => {
    expect(pushTopic("t1")).toBe("t1");
    expect(pushTopic("rule_abc-DEF")).toBe("rule_abc-DEF");
  });
  it("trims tags to the 32 base64url characters RFC 8030 allows", () => {
    const topic = pushTopic("rule-596b9224-7a4e-4d63-9319-4af6431aed02");
    expect(topic).toBe("rule-596b9224-7a4e-4d63-9319-4af");
    expect(topic?.length).toBe(32);
    expect(pushTopic("a b/c+d=")).toBe("abcd");
    expect(pushTopic("///")).toBeUndefined();
  });
});
