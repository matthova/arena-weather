import { describe, expect, it } from "vitest";
import { json, makeWorld, signUpAndSignIn } from "./helpers.js";

const sub = (endpoint: string) => ({
  subscription: {
    endpoint,
    expirationTime: null,
    keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
  },
  userAgent: "TestBrowser/1.0",
});

describe("/api/push", () => {
  it("exposes the VAPID public key, or 503 when push is not configured", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/push/public-key");
    expect(r.status).toBe(200);
    expect(r.data.publicKey).toBe("BFakePublicKey");
    const off = makeWorld({
      push: {
        enabled: false,
        publicKey: null,
        send: async () => ({ ok: false, status: 0, gone: false }),
      },
    });
    expect((await json(off, null)("GET", "/api/push/public-key")).status).toBe(503);
  });

  it("registers, lists, re-registers (upsert) and unregisters subscriptions", async () => {
    const w = makeWorld();
    const { cookie } = await signUpAndSignIn(w);
    const api = json(w, cookie);
    const created = await api("POST", "/api/push/subscriptions", sub("https://push.example/one"));
    expect(created.status).toBe(201);
    expect(created.data.subscription.endpoint).toBe("https://push.example/one");

    const again = await api("POST", "/api/push/subscriptions", sub("https://push.example/one"));
    expect(again.status).toBe(201);
    expect(again.data.subscription.id).toBe(created.data.subscription.id);

    await api("POST", "/api/push/subscriptions", sub("https://push.example/two"));
    const list = await api("GET", "/api/push/subscriptions");
    expect(list.data.subscriptions).toHaveLength(2);
    expect(list.data.subscriptions[0].userAgent).toBe("TestBrowser/1.0");

    const del = await api("DELETE", "/api/push/subscriptions", {
      endpoint: "https://push.example/one",
    });
    expect(del.status).toBe(204);
    expect((await api("GET", "/api/push/subscriptions")).data.subscriptions).toHaveLength(1);
    expect(
      (await api("DELETE", "/api/push/subscriptions", { endpoint: "https://push.example/one" }))
        .status,
    ).toBe(404);
  });

  it("validates the subscription body and requires auth", async () => {
    const w = makeWorld();
    expect((await json(w, null)("POST", "/api/push/subscriptions", sub("https://x"))).status).toBe(
      401,
    );
    const { cookie } = await signUpAndSignIn(w);
    const bad = await json(w, cookie)("POST", "/api/push/subscriptions", {
      subscription: { endpoint: "nope" },
    });
    expect(bad.status).toBe(400);
  });
});
