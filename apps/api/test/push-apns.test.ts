import { describe, expect, it } from "vitest";
import { notifyUser } from "../src/notify.js";
import { fakeApns, json, makeWorld, sampleRule, signUpAndSignIn } from "./helpers.js";

const APNS_TOKEN = "0123456789abcdef".repeat(4);

describe('APNs devices (channel "apns" on /api/push/devices)', () => {
  it("registers an iPhone's token, lists it with its channel, reports deliverability, unregisters it", async () => {
    const w = makeWorld();
    const { cookie } = await signUpAndSignIn(w);
    const api = json(w, cookie);

    const created = await api("POST", "/api/push/devices", {
      channel: "apns",
      token: APNS_TOKEN,
      userAgent: "WeatherAlerts/0.1.0 (iPhone15,3; iOS 17.5)",
    });
    expect(created.status).toBe(201);
    expect(created.data.device).toMatchObject({ channel: "apns", token: APNS_TOKEN });
    expect(created.data.deliverable).toBe(true); // the test world's fake APNs sender is enabled

    const list = await api("GET", "/api/push/subscriptions");
    expect(list.data.subscriptions).toHaveLength(1);
    expect(list.data.subscriptions[0]).toMatchObject({ channel: "apns", endpoint: APNS_TOKEN });

    expect((await api("DELETE", "/api/push/devices", { token: APNS_TOKEN })).status).toBe(204);
    expect((await api("GET", "/api/push/subscriptions")).data.subscriptions).toHaveLength(0);
  });

  it("says deliverable=false when the API has no APNs key", async () => {
    const w = makeWorld({ apns: fakeApns({ enabled: false }) });
    const { cookie } = await signUpAndSignIn(w);
    const created = await json(w, cookie)("POST", "/api/push/devices", {
      channel: "apns",
      token: APNS_TOKEN,
    });
    expect(created.status).toBe(201);
    expect(created.data.deliverable).toBe(false);
    const config = await json(w, null)("GET", "/api/config");
    expect(config.data.pushChannels).toMatchObject({ apns: false });
  });

  it("GET /api/config lists apns next to fcm", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/config");
    expect(r.data.pushChannels).toEqual({ fcm: true, apns: true });
  });

  it("notifyUser hands apns tokens to the APNs sender and prunes tokens Apple reports gone", async () => {
    const w = makeWorld();
    const { cookie, userId } = await signUpAndSignIn(w);
    const api = json(w, cookie);
    await api("POST", "/api/push/devices", { channel: "apns", token: APNS_TOKEN });
    await api("POST", "/api/push/subscriptions", {
      subscription: {
        endpoint: "https://push.example/web",
        keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
      },
    });
    const result = await notifyUser(
      w.services,
      userId,
      { title: "T", body: "B" },
      { ruleId: null, kind: "test" },
    );
    expect(result).toEqual({ attempted: 2, delivered: 2, failed: 0 });
    expect(w.apns.sent.map((s) => s.token)).toEqual([APNS_TOKEN]);
    expect(w.push.sent.map((s) => s.subscription.endpoint)).toEqual(["https://push.example/web"]);

    const dead = makeWorld({ apns: fakeApns({ fail: () => 410 }) });
    const d = await signUpAndSignIn(dead);
    await json(dead, d.cookie)("POST", "/api/push/devices", { channel: "apns", token: APNS_TOKEN });
    const r = await notifyUser(
      dead.services,
      d.userId,
      { title: "T", body: "B" },
      { ruleId: null, kind: "test" },
    );
    expect(r).toEqual({ attempted: 1, delivered: 0, failed: 1 });
    expect(
      (await json(dead, d.cookie)("GET", "/api/push/subscriptions")).data.subscriptions,
    ).toHaveLength(0);
  });

  it("'test this rule now' reaches the iPhone too", async () => {
    const w = makeWorld();
    const { cookie } = await signUpAndSignIn(w);
    const api = json(w, cookie);
    await api("POST", "/api/push/devices", { channel: "apns", token: APNS_TOKEN });
    const rule = await api("POST", "/api/rules", sampleRule());
    const test = await api("POST", `/api/rules/${rule.data.rule.id}/test`);
    expect(test.status).toBe(200);
    expect(test.data.push).toEqual({ attempted: 1, delivered: 1, failed: 0 });
    expect(w.apns.sent[0]?.token).toBe(APNS_TOKEN);
    expect(w.apns.sent[0]?.message.title).toMatch(/^Test: /);
  });
});

describe("GET /api/native/handoff (browser sign-in → native session)", () => {
  it("turns a cookie session into a one-time token the app exchanges for a bearer session", async () => {
    const w = makeWorld();
    const { cookie, email } = await signUpAndSignIn(w);
    const res = await w.app.request(
      "/api/native/handoff?redirect=weatheralerts%3A%2F%2Fauth%2Fcallback",
      { headers: { cookie }, redirect: "manual" },
      w.env,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.protocol).toBe("weatheralerts:");
    expect(location.host).toBe("auth");
    const ott = location.searchParams.get("ott");
    expect(ott).toBeTruthy();

    const verify = await w.app.request(
      "/api/auth/one-time-token/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: w.env.APP_URL },
        body: JSON.stringify({ token: ott }),
      },
      w.env,
    );
    expect(verify.status).toBe(200);
    const bearerToken = verify.headers.get("set-auth-token");
    expect(bearerToken).toBeTruthy();
    const me = await w.app.request(
      "/api/me",
      { headers: { authorization: `Bearer ${bearerToken}` } },
      w.env,
    );
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(email);

    // one-time: a second exchange fails
    const again = await w.app.request(
      "/api/auth/one-time-token/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: w.env.APP_URL },
        body: JSON.stringify({ token: ott }),
      },
      w.env,
    );
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it("needs a session and only redirects to allow-listed app schemes", async () => {
    const w = makeWorld();
    const anon = await w.app.request(
      "/api/native/handoff?redirect=weatheralerts%3A%2F%2Fauth%2Fcallback",
      { redirect: "manual" },
      w.env,
    );
    expect(anon.status).toBe(401);
    const { cookie } = await signUpAndSignIn(w);
    for (const bad of ["evil://steal", "https://attacker.example/", "not a url", ""]) {
      const r = await w.app.request(
        `/api/native/handoff?redirect=${encodeURIComponent(bad)}`,
        { headers: { cookie }, redirect: "manual" },
        w.env,
      );
      expect(r.status).toBe(400);
    }
  });
});
