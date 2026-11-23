import { describe, expect, it } from "vitest";
import { runChecker } from "../src/checker.js";
import { fakePush, json, makeWorld, sampleRule, signUpAndSignIn } from "./helpers.js";

describe("checker (cron job)", () => {
  it("fires once when a rule becomes true, re-arms when it becomes false, skips paused rules", async () => {
    const w = makeWorld();
    const { cookie } = await signUpAndSignIn(w);
    const api = json(w, cookie);
    await api("POST", "/api/push/subscriptions", {
      subscription: {
        endpoint: "https://push.example/a",
        keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
      },
    });
    const { id } = (await api("POST", "/api/rules", sampleRule())).data.rule;

    w.provider.values = { precipitation_probability: 10 };
    let s = await runChecker(w.services);
    expect(s).toMatchObject({ evaluated: 1, matched: 0, fired: 0, errors: [] });
    expect(w.push.sent).toHaveLength(0);

    w.provider.values = { precipitation_probability: 80 };
    s = await runChecker(w.services);
    expect(s).toMatchObject({ evaluated: 1, matched: 1, fired: 1 });
    expect(w.push.sent).toHaveLength(1);
    expect(w.push.sent[0]?.message).toMatchObject({
      title: "Rain in Berlin",
      body: "Precipitation chance >= 60 % in Berlin",
      tag: `rule-${id}`,
    });
    let rule = (await api("GET", `/api/rules/${id}`)).data.rule;
    expect(rule.armed).toBe(false);
    expect(rule.lastFiredAt).not.toBeNull();

    // still true: no second notification
    s = await runChecker(w.services);
    expect(s.fired).toBe(0);
    expect(w.push.sent).toHaveLength(1);

    // false again: re-arm silently
    w.provider.values = { precipitation_probability: 0 };
    await runChecker(w.services);
    rule = (await api("GET", `/api/rules/${id}`)).data.rule;
    expect(rule.armed).toBe(true);

    // paused rules are not evaluated at all
    await api("POST", `/api/rules/${id}/pause`);
    w.provider.values = { precipitation_probability: 100 };
    s = await runChecker(w.services);
    expect(s.evaluated).toBe(0);
    expect(w.push.sent).toHaveLength(1);

    // resume: fires again on the next true evaluation
    await api("POST", `/api/rules/${id}/resume`);
    s = await runChecker(w.services);
    expect(s.fired).toBe(1);
    expect(w.push.sent).toHaveLength(2);
  });

  it("records provider errors on the rule without losing trigger state", async () => {
    const w = makeWorld();
    const { cookie } = await signUpAndSignIn(w);
    const api = json(w, cookie);
    const { id } = (await api("POST", "/api/rules", sampleRule())).data.rule;
    w.provider.forecast = async () => {
      throw new Error("Open-Meteo down");
    };
    const s = await runChecker(w.services);
    expect(s.errors).toEqual([{ ruleId: id, error: "Open-Meteo down" }]);
    const rule = (await api("GET", `/api/rules/${id}`)).data.rule;
    expect(rule.armed).toBe(true);
    expect(rule.lastEvaluatedAt).not.toBeNull();
  });

  it("deletes subscriptions the push service reports gone and keeps a notification log", async () => {
    const push = fakePush({ fail: (endpoint) => (endpoint.endsWith("/dead") ? 410 : 201) });
    const w = makeWorld({ push });
    const { cookie, userId } = await signUpAndSignIn(w);
    const api = json(w, cookie);
    for (const e of ["https://push.example/live", "https://push.example/dead"]) {
      await api("POST", "/api/push/subscriptions", {
        subscription: { endpoint: e, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } },
      });
    }
    await api("POST", "/api/rules", sampleRule());
    w.provider.values = { precipitation_probability: 100 };
    const s = await runChecker(w.services);
    expect(s.fired).toBe(1);
    const subs = (await api("GET", "/api/push/subscriptions")).data.subscriptions;
    expect(subs.map((x: { endpoint: string }) => x.endpoint)).toEqual([
      "https://push.example/live",
    ]);
    const log = await w.services.repo.notifications.listByUser(userId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "alert", attempted: 2, delivered: 1 });
  });

  it("POST /api/internal/run-checker needs the checker token", async () => {
    const w = makeWorld({ env: { CHECKER_TOKEN: "s3cret" } });
    expect((await json(w, null)("POST", "/api/internal/run-checker")).status).toBe(403);
    const res = await w.app.request(
      "/api/internal/run-checker",
      { method: "POST", headers: { authorization: "Bearer s3cret" } },
      w.env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { evaluated: number }).evaluated).toBe(0);
  });
});
