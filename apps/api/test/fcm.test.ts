import { describe, expect, it } from "vitest";
import { runChecker } from "../src/checker.js";
import {
  buildFcmMessage,
  createFcmSender,
  createServiceAccountJwt,
  createTokenSource,
  type FcmServiceAccount,
  fetchAccessToken,
  isTokenGone,
  parseServiceAccount,
} from "../src/push/fcm.js";
import { b64urlDecode } from "../src/push/webpush.js";
import { fakeFcm, json, makeWorld, sampleRule, signUpAndSignIn } from "./helpers.js";

const te = new TextEncoder();

/** A throwaway RSA key pair as a service-account JSON would carry it (PKCS#8 PEM, with literal \n). */
async function testServiceAccount(): Promise<{
  account: FcmServiceAccount;
  json: string;
  publicKey: CryptoKey;
}> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  let bin = "";
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const lines = btoa(bin).match(/.{1,64}/g) ?? [];
  const pem = `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
  const account: FcmServiceAccount = {
    project_id: "weather-test",
    client_email: "fcm@weather-test.iam.gserviceaccount.com",
    private_key: pem,
    token_uri: "https://oauth2.example/token",
  };
  // the key file escapes newlines; a secret pasted from it keeps them as the two characters \n
  const json = JSON.stringify(account);
  return { account, json, publicKey: pair.publicKey };
}

function decodeJwt(jwt: string) {
  const [h, p, s] = jwt.split(".");
  const dec = (x: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(x)));
  return { header: dec(h ?? ""), payload: dec(p ?? ""), signature: b64urlDecode(s ?? "") };
}

/** A fake Google token endpoint + FCM endpoint. */
function fakeGoogle(opts: { fcmStatus?: (token: string, call: number) => number } = {}) {
  const calls: { url: string; headers: Headers; body: string }[] = [];
  let tokenCount = 0;
  let fcmCalls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, headers, body });
    if (url === "https://oauth2.example/token") {
      tokenCount++;
      return Response.json({
        access_token: `ya29.token-${tokenCount}`,
        expires_in: 3599,
        token_type: "Bearer",
      });
    }
    if (url.includes("/messages:send")) {
      fcmCalls++;
      const token = (JSON.parse(body) as { message: { token: string } }).message.token;
      const status = opts.fcmStatus?.(token, fcmCalls) ?? 200;
      if (status === 200)
        return Response.json({ name: `projects/weather-test/messages/${fcmCalls}` });
      if (status === 404)
        return new Response(
          JSON.stringify({
            error: {
              code: 404,
              message: "Requested entity was not found.",
              status: "NOT_FOUND",
              details: [
                {
                  "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                  errorCode: "UNREGISTERED",
                },
              ],
            },
          }),
          { status: 404 },
        );
      return new Response(JSON.stringify({ error: { code: status, status: "ERR" } }), { status });
    }
    return new Response("no", { status: 500 });
  };
  return { fetchImpl, calls, tokenCount: () => tokenCount };
}

describe("FCM service-account auth", () => {
  it("parses a key file and rejects incomplete ones", async () => {
    const { json, account } = await testServiceAccount();
    expect(parseServiceAccount(json)).toMatchObject({
      project_id: "weather-test",
      client_email: account.client_email,
    });
    expect(() => parseServiceAccount("{not json")).toThrow(/not valid JSON/);
    expect(() => parseServiceAccount(JSON.stringify({ project_id: "x" }))).toThrow(
      /missing "client_email"/,
    );
  });

  it("mints an RS256 JWT Google will accept (claims + verifiable signature)", async () => {
    const { account, publicKey } = await testServiceAccount();
    const now = 1_700_000_000;
    const jwt = await createServiceAccountJwt(
      account,
      "https://www.googleapis.com/auth/firebase.messaging",
      now,
    );
    const { header, payload, signature } = decodeJwt(jwt);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload).toEqual({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.example/token",
      iat: now,
      exp: now + 3600,
    });
    const signingInput = jwt.split(".").slice(0, 2).join(".");
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signature,
      te.encode(signingInput),
    );
    expect(valid).toBe(true);
  });

  it("accepts the private key with escaped newlines as pasted into a secret", async () => {
    const { account } = await testServiceAccount();
    const escaped = { ...account, private_key: account.private_key.replace(/\n/g, "\\n") };
    const jwt = await createServiceAccountJwt(escaped, "scope", 1);
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("exchanges the assertion for an access token and caches it until it is about to expire", async () => {
    const { account } = await testServiceAccount();
    const google = fakeGoogle();
    const t = await fetchAccessToken(account, google.fetchImpl, 1000);
    expect(t).toEqual({ token: "ya29.token-1", expiresAt: 1000 + 3599 });
    const first = google.calls[0];
    expect(first?.url).toBe("https://oauth2.example/token");
    const form = new URLSearchParams(first?.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);

    let now = 1000;
    const source = createTokenSource(account, google.fetchImpl, () => now);
    const [a, b] = await Promise.all([source.get(), source.get()]);
    expect(a).toBe("ya29.token-2");
    expect(b).toBe("ya29.token-2"); // concurrent callers share one exchange
    expect(google.tokenCount()).toBe(2);
    now = 1000 + 3599 - 120;
    expect(await source.get()).toBe("ya29.token-2"); // still fresh
    now = 1000 + 3599 - 30;
    expect(await source.get()).toBe("ya29.token-3"); // within 60 s of expiry: refreshed
    source.invalidate();
    expect(await source.get()).toBe("ya29.token-4");
  });

  it("surfaces token endpoint failures", async () => {
    const { account } = await testServiceAccount();
    const fetchImpl: typeof fetch = async () =>
      new Response('{"error":"invalid_grant"}', { status: 400 });
    await expect(fetchAccessToken(account, fetchImpl)).rejects.toThrow(/400.*invalid_grant/);
  });
});

describe("FCM messages", () => {
  it("builds a v1 message with a notification, string data and a collapse key from the tag", () => {
    const m = buildFcmMessage("device-token", {
      title: "Rain in Berlin",
      body: "Precipitation chance >= 60 % in Berlin",
      url: "https://app.example/rules/abc",
      tag: "rule-5f0c2a3e-1111-2222-3333-444444444444",
      data: { ruleId: "abc", matched: true },
    });
    expect(m.message.token).toBe("device-token");
    expect(m.message.notification).toEqual({
      title: "Rain in Berlin",
      body: "Precipitation chance >= 60 % in Berlin",
    });
    expect(m.message.data).toEqual({
      title: "Rain in Berlin",
      body: "Precipitation chance >= 60 % in Berlin",
      url: "https://app.example/rules/abc",
      tag: "rule-5f0c2a3e-1111-2222-3333-444444444444",
      ruleId: "abc",
      matched: "true",
    });
    expect(m.message.android.collapse_key).toBe("rule-5f0c2a3e-1111-2222-3333-444444444444");
    expect(m.message.android.notification.channel_id).toBe("weather_alerts");
    expect(m.message.android.priority).toBe("HIGH");
  });

  it("recognises dead tokens", () => {
    expect(isTokenGone(404, undefined)).toBe(true);
    expect(
      isTokenGone(
        400,
        '{"error":{"status":"INVALID_ARGUMENT","message":"The registration token is not a valid FCM registration token"}}',
      ),
    ).toBe(true);
    expect(
      isTokenGone(400, '{"error":{"status":"INVALID_ARGUMENT","message":"Invalid JSON payload"}}'),
    ).toBe(false);
    expect(isTokenGone(500, "boom")).toBe(false);
    expect(isTokenGone(429, '{"error":{"status":"QUOTA_EXCEEDED"}}')).toBe(false);
  });

  it("sends with a bearer token, retries once after a 401, reports UNREGISTERED as gone", async () => {
    const { json } = await testServiceAccount();
    const google = fakeGoogle({
      fcmStatus: (token, call) => {
        if (token === "dead") return 404;
        if (token === "stale" && call === 1) return 401;
        return 200;
      },
    });
    const sender = createFcmSender(json, { fetch: google.fetchImpl });
    expect(sender.enabled).toBe(true);
    expect(sender.projectId).toBe("weather-test");

    const ok = await sender.send("stale", { title: "t", body: "b" });
    expect(ok).toMatchObject({ ok: true, status: 200, gone: false });
    expect(ok.messageId).toMatch(/^projects\/weather-test\/messages\//);
    const sends = google.calls.filter((c) => c.url.includes("/messages:send"));
    expect(sends).toHaveLength(2); // 401 then retry with a fresh token
    expect(sends[0]?.url).toBe("https://fcm.googleapis.com/v1/projects/weather-test/messages:send");
    expect(sends[0]?.headers.get("authorization")).toBe("Bearer ya29.token-1");
    expect(sends[1]?.headers.get("authorization")).toBe("Bearer ya29.token-2");

    const dead = await sender.send("dead", { title: "t", body: "b" });
    expect(dead).toMatchObject({ ok: false, status: 404, gone: true });
    expect(dead.body).toMatch(/UNREGISTERED/);
  });

  it("is disabled without a service account and when the secret is malformed", async () => {
    const off = createFcmSender(undefined);
    expect(off.enabled).toBe(false);
    expect(await off.send("x", { title: "t", body: "b" })).toMatchObject({
      ok: false,
      status: 0,
      body: /not configured/,
    });
    const bad = createFcmSender("{}");
    expect(bad.enabled).toBe(false);
    expect((await bad.send("x", { title: "t", body: "b" })).body).toMatch(/missing/);
  });
});

describe("/api/push/devices (native device tokens)", () => {
  const token = `fcm-token-${"x".repeat(140)}`;

  it("registers, re-registers (idempotent), lists alongside web push, and forgets a device", async () => {
    const w = makeWorld();
    const { cookie } = await signUpAndSignIn(w);
    const api = json(w, cookie);

    const created = await api("POST", "/api/push/devices", {
      channel: "fcm",
      token,
      userAgent: "Android 14; Pixel 8",
    });
    expect(created.status).toBe(201);
    expect(created.data.device).toMatchObject({
      channel: "fcm",
      token,
      userAgent: "Android 14; Pixel 8",
    });
    expect(created.data.deliverable).toBe(true);

    const again = await api("POST", "/api/push/devices", { channel: "fcm", token });
    expect(again.status).toBe(201);
    expect(again.data.device.id).toBe(created.data.device.id);

    await api("POST", "/api/push/subscriptions", {
      subscription: {
        endpoint: "https://push.example/web",
        keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
      },
    });
    const list = await api("GET", "/api/push/subscriptions");
    expect(list.data.subscriptions.map((s: { channel: string }) => s.channel).sort()).toEqual([
      "fcm",
      "webpush",
    ]);

    expect((await api("DELETE", "/api/push/devices", { token })).status).toBe(204);
    expect((await api("DELETE", "/api/push/devices", { token })).status).toBe(404);
    expect((await api("GET", "/api/push/subscriptions")).data.subscriptions).toHaveLength(1);
  });

  it("validates the body, requires auth, and reports when FCM is not configured", async () => {
    const w = makeWorld({ fcm: fakeFcm({ enabled: false }) });
    expect(
      (await json(w, null)("POST", "/api/push/devices", { channel: "fcm", token })).status,
    ).toBe(401);
    const { cookie } = await signUpAndSignIn(w);
    const api = json(w, cookie);
    expect((await api("POST", "/api/push/devices", { channel: "sms", token })).status).toBe(400);
    expect(
      (await api("POST", "/api/push/devices", { channel: "fcm", token: "short" })).status,
    ).toBe(400);
    const r = await api("POST", "/api/push/devices", { channel: "fcm", token });
    expect(r.status).toBe(201);
    expect(r.data.deliverable).toBe(false);
    const config = await api("GET", "/api/config");
    expect(config.data.pushChannels).toEqual({ fcm: false });
  });

  it("a user's rules notify FCM devices and web push alike; dead tokens are pruned", async () => {
    const fcm = fakeFcm({ fail: (t) => (t.endsWith("dead") ? 404 : 200) });
    const w = makeWorld({ fcm });
    const { cookie } = await signUpAndSignIn(w);
    const api = json(w, cookie);
    await api("POST", "/api/push/devices", { channel: "fcm", token });
    await api("POST", "/api/push/devices", { channel: "fcm", token: `${token}-dead` });
    await api("POST", "/api/push/subscriptions", {
      subscription: {
        endpoint: "https://push.example/web",
        keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
      },
    });
    const { id } = (await api("POST", "/api/rules", sampleRule())).data.rule;

    // "test this rule now" reaches every device
    const test = await api("POST", `/api/rules/${id}/test`);
    expect(test.status).toBe(200);
    expect(test.data.push).toEqual({ attempted: 3, delivered: 2, failed: 1 });
    expect(fcm.sent).toHaveLength(2);
    expect(fcm.sent[0]?.message.title).toBe("Test: Rain in Berlin");
    expect(w.push.sent).toHaveLength(1);
    // the UNREGISTERED token is gone
    const left = (await api("GET", "/api/push/subscriptions")).data.subscriptions;
    expect(left).toHaveLength(2);
    expect(left.some((s: { endpoint: string }) => s.endpoint.endsWith("dead"))).toBe(false);

    // and the cron checker too
    w.provider.values = { precipitation_probability: 90 };
    const s = await runChecker(w.services);
    expect(s.fired).toBe(1);
    expect(fcm.sent).toHaveLength(3);
    expect(fcm.sent[2]?.message).toMatchObject({ title: "Rain in Berlin", tag: `rule-${id}` });
  });
});

describe("bearer sessions for native clients", () => {
  it("sign-in returns set-auth-token and the token authenticates like the cookie", async () => {
    const w = makeWorld();
    const { email } = await signUpAndSignIn(w);
    const res = await w.app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: w.env.APP_URL },
        body: JSON.stringify({ email, password: "correct horse battery staple" }),
      },
      w.env,
    );
    expect(res.status).toBe(200);
    const token = res.headers.get("set-auth-token");
    expect(token).toBeTruthy();

    const me = await w.app.request(
      "/api/me",
      { headers: { authorization: `Bearer ${token}` } },
      w.env,
    );
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email);
    const rules = await w.app.request(
      "/api/rules",
      { headers: { authorization: `Bearer ${token}` } },
      w.env,
    );
    expect(rules.status).toBe(200);
    expect((await w.app.request("/api/rules", {}, w.env)).status).toBe(401);
  });
});
