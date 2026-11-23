import { describe, expect, it } from "vitest";
import {
  APNS_HOSTS,
  apnsPayload,
  apnsRequestUrl,
  apnsTokenIsGone,
  createApnsJwt,
  createApnsTokenProvider,
  importApnsKey,
  pemToDer,
  sendApns,
} from "../src/push/apns.js";
import { apnsSenderFromEnv } from "../src/push/apns-sender.js";
import { b64urlDecode } from "../src/push/webpush.js";

/** What Apple's developer portal hands out: a P-256 key as a PKCS#8 PEM (.p8). */
async function fakeP8() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const der = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n");
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey, der };
}

const config = {
  teamId: "TEAM123456",
  keyId: "KEYID12345",
  bundleId: "com.example.weatheralerts",
};

const decodeJson = (part: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(part)));

describe("APNs token-based auth on WebCrypto (runs inside workerd)", () => {
  it("reads a .p8 PEM, also when pasted with escaped newlines", async () => {
    const { pem, der } = await fakeP8();
    expect(pemToDer(pem)).toEqual(der);
    expect(pemToDer(pem.replace(/\n/g, "\\n"))).toEqual(der);
    expect(() => pemToDer("-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----")).toThrow();
  });

  it("signs a provider token (ES256, kid header, iss + iat claims) that verifies with the public key", async () => {
    const { pem, publicKey } = await fakeP8();
    const key = await importApnsKey(pem);
    const jwt = await createApnsJwt(key, config, 1_700_000_000);
    const [h, p, s] = jwt.split(".") as [string, string, string];
    expect(decodeJson(h)).toEqual({ alg: "ES256", kid: "KEYID12345" });
    expect(decodeJson(p)).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 });
    const sig = b64urlDecode(s);
    expect(sig).toHaveLength(64); // raw r||s, not DER
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it("caches the provider token for 50 minutes and re-issues after that or when invalidated", async () => {
    const { pem } = await fakeP8();
    const tokens = createApnsTokenProvider({ ...config, privateKey: pem });
    const t0 = await tokens.token(1_000_000);
    expect(await tokens.token(1_000_000 + 49 * 60)).toBe(t0);
    const t1 = await tokens.token(1_000_000 + 51 * 60);
    expect(t1).not.toBe(t0);
    expect(decodeJson(t1.split(".")[1] ?? "").iat).toBe(1_000_000 + 51 * 60);
    tokens.invalidate();
    expect(await tokens.token(1_000_000 + 51 * 60)).not.toBe(t1);
  });

  it("picks the sandbox or production host per token, falling back to the configured default", () => {
    expect(apnsRequestUrl({ token: "ab" }, {})).toBe(`${APNS_HOSTS.production}/3/device/ab`);
    expect(apnsRequestUrl({ token: "ab" }, { defaultEnvironment: "sandbox" })).toBe(
      `${APNS_HOSTS.sandbox}/3/device/ab`,
    );
    expect(apnsRequestUrl({ token: "ab", environment: "sandbox" }, {})).toBe(
      `${APNS_HOSTS.sandbox}/3/device/ab`,
    );
  });

  it("builds an alert payload with the same custom fields as the web push message", () => {
    const payload = apnsPayload({
      title: "Rain",
      body: "Precipitation chance >= 60 % in Berlin",
      url: "https://app/rules/r1",
      tag: "rule-r1",
      data: { ruleId: "r1", matched: true },
    });
    expect(payload).toEqual({
      aps: {
        alert: { title: "Rain", body: "Precipitation chance >= 60 % in Berlin" },
        sound: "default",
        "thread-id": "rule-r1",
      },
      url: "https://app/rules/r1",
      tag: "rule-r1",
      data: { ruleId: "r1", matched: true },
    });
  });

  it("knows which responses mean the device token is dead", () => {
    expect(apnsTokenIsGone(410, "Unregistered")).toBe(true);
    expect(apnsTokenIsGone(400, "BadDeviceToken")).toBe(true);
    expect(apnsTokenIsGone(400, "DeviceTokenNotForTopic")).toBe(true);
    expect(apnsTokenIsGone(400, "PayloadTooLarge")).toBe(false);
    expect(apnsTokenIsGone(403, "InvalidProviderToken")).toBe(false);
    expect(apnsTokenIsGone(200, undefined)).toBe(false);
  });

  it("POSTs to /3/device/<token> with the APNs headers and reports 200 as delivered", async () => {
    const { pem } = await fakeP8();
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("", { status: 200, headers: { "apns-id": "123" } });
    }) as typeof fetch;
    const token = "a".repeat(64);
    const r = await sendApns(
      { token, environment: "sandbox" },
      { title: "T", body: "B", tag: "rule-abc", url: "https://app/rules/abc" },
      { ...config, privateKey: pem },
      { fetch: fetchImpl, now: 1_700_000_000 },
    );
    expect(r).toMatchObject({ ok: true, status: 200, gone: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.sandbox.push.apple.com/3/device/${token}`);
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(
      /^bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(headers["apns-topic"]).toBe("com.example.weatheralerts");
    expect(headers["apns-push-type"]).toBe("alert");
    expect(headers["apns-priority"]).toBe("10");
    expect(headers["apns-collapse-id"]).toBe("rule-abc");
    expect(headers["apns-expiration"]).toBe(String(1_700_000_000 + 4 * 3600));
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.aps.alert).toEqual({ title: "T", body: "B" });
    expect(body.url).toBe("https://app/rules/abc");
  });

  it("maps 410 Unregistered to gone and keeps Apple's reason in the body", async () => {
    const { pem } = await fakeP8();
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ reason: "Unregistered", timestamp: 1 }), {
        status: 410,
      })) as typeof fetch;
    const r = await sendApns(
      { token: "b".repeat(64) },
      { title: "T", body: "B" },
      { ...config, privateKey: pem },
      { fetch: fetchImpl },
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe(410);
    expect(r.gone).toBe(true);
    expect(r.body).toContain("Unregistered");
  });

  it("re-issues the provider token once after ExpiredProviderToken", async () => {
    const { pem } = await fakeP8();
    const seen: string[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
      return seen.length === 1
        ? new Response(JSON.stringify({ reason: "ExpiredProviderToken" }), { status: 403 })
        : new Response("", { status: 200 });
    }) as typeof fetch;
    const tokens = createApnsTokenProvider({ ...config, privateKey: pem });
    await tokens.token(1);
    const r = await sendApns(
      { token: "c".repeat(64) },
      { title: "T", body: "B" },
      { ...config, privateKey: pem },
      { fetch: fetchImpl, tokenProvider: tokens, now: 5_000 },
    );
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("refuses payloads over 4 KB without calling Apple", async () => {
    const { pem } = await fakeP8();
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const r = await sendApns(
      { token: "d".repeat(64) },
      { title: "T", body: "x".repeat(5000) },
      { ...config, privateKey: pem },
      { fetch: fetchImpl },
    );
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("APNs sender from the Worker env", () => {
  it("is off until all four APNS_* values are set, and then posts to the configured host", async () => {
    const { pem } = await fakeP8();
    const off = apnsSenderFromEnv({ APNS_TEAM_ID: config.teamId, APNS_KEY_ID: config.keyId });
    expect(off.enabled).toBe(false);
    expect((await off.send("a".repeat(64), { title: "T", body: "B" })).body).toMatch(
      /not configured/,
    );

    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const on = apnsSenderFromEnv(
      {
        APNS_TEAM_ID: config.teamId,
        APNS_KEY_ID: config.keyId,
        APNS_PRIVATE_KEY: pem,
        APNS_BUNDLE_ID: config.bundleId,
        APNS_ENVIRONMENT: "sandbox",
      },
      fetchImpl,
    );
    expect(on.enabled).toBe(true);
    expect(on.bundleId).toBe(config.bundleId);
    const r = await on.send("e".repeat(64), { title: "T", body: "B" });
    expect(r.ok).toBe(true);
    expect(urls).toEqual([`https://api.sandbox.push.apple.com/3/device/${"e".repeat(64)}`]);
  });

  it("retries a BadDeviceToken once on the other host (debug builds' sandbox tokens) before giving up", async () => {
    const { pem } = await fakeP8();
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return String(url).includes("sandbox")
        ? new Response("", { status: 200 })
        : new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 });
    }) as typeof fetch;
    const sender = apnsSenderFromEnv(
      {
        APNS_TEAM_ID: config.teamId,
        APNS_KEY_ID: config.keyId,
        APNS_PRIVATE_KEY: pem,
        APNS_BUNDLE_ID: config.bundleId,
      },
      fetchImpl,
    );
    const ok = await sender.send("f".repeat(64), { title: "T", body: "B" });
    expect(ok.ok).toBe(true);
    expect(urls.map((u) => new URL(u).host)).toEqual([
      "api.push.apple.com",
      "api.sandbox.push.apple.com",
    ]);

    // dead on both hosts: gone, so the token is pruned
    const deadFetch = (async () =>
      new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 })) as typeof fetch;
    const dead = apnsSenderFromEnv(
      {
        APNS_TEAM_ID: config.teamId,
        APNS_KEY_ID: config.keyId,
        APNS_PRIVATE_KEY: pem,
        APNS_BUNDLE_ID: config.bundleId,
      },
      deadFetch,
    );
    const r = await dead.send("f".repeat(64), { title: "T", body: "B" });
    expect(r.ok).toBe(false);
    expect(r.gone).toBe(true);
  });
});
