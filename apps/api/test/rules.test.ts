import { describe, expect, it } from "vitest";
import { json, makeWorld, sampleRule, signUpAndSignIn } from "./helpers.js";

describe("/api/rules", () => {
  it("creates, lists, reads, updates, pauses, resumes and deletes a rule", async () => {
    const w = makeWorld();
    const { cookie } = await signUpAndSignIn(w);
    const api = json(w, cookie);

    const created = await api("POST", "/api/rules", sampleRule());
    expect(created.status).toBe(201);
    const rule = created.data.rule;
    expect(rule.id).toBeTypeOf("string");
    expect(rule).toMatchObject({
      name: "Rain in Berlin",
      paused: false,
      armed: true,
      lastFiredAt: null,
    });
    expect(rule.root.children[0].quantifier).toBe("any"); // default applied

    const list = await api("GET", "/api/rules");
    expect(list.data.rules).toHaveLength(1);

    const got = await api("GET", `/api/rules/${rule.id}`);
    expect(got.status).toBe(200);
    expect(got.data.rule.id).toBe(rule.id);

    const updated = await api("PUT", `/api/rules/${rule.id}`, sampleRule({ name: "Rain soon" }));
    expect(updated.status).toBe(200);
    expect(updated.data.rule.name).toBe("Rain soon");

    const paused = await api("POST", `/api/rules/${rule.id}/pause`);
    expect(paused.data.rule.paused).toBe(true);
    const resumed = await api("POST", `/api/rules/${rule.id}/resume`);
    expect(resumed.data.rule.paused).toBe(false);

    const deleted = await api("DELETE", `/api/rules/${rule.id}`);
    expect(deleted.status).toBe(204);
    expect((await api("GET", `/api/rules/${rule.id}`)).status).toBe(404);
  });

  it("rejects invalid definitions with zod issues", async () => {
    const w = makeWorld();
    const { cookie } = await signUpAndSignIn(w);
    const r = await json(w, cookie)("POST", "/api/rules", sampleRule({ name: "" }));
    expect(r.status).toBe(400);
    expect(r.data.error.code).toBe("bad_request");
    expect(Array.isArray(r.data.error.issues)).toBe(true);
    const r2 = await json(w, cookie)(
      "POST",
      "/api/rules",
      sampleRule({
        root: {
          type: "group",
          operator: "all",
          children: [
            {
              type: "condition",
              granularity: "hourly",
              variable: "nope",
              comparator: ">",
              value: 1,
            },
          ],
        },
      }),
    );
    expect(r2.status).toBe(400);
  });

  it("isolates rules per user", async () => {
    const w = makeWorld();
    const a = await signUpAndSignIn(w);
    const b = await signUpAndSignIn(w);
    const created = await json(w, a.cookie)("POST", "/api/rules", sampleRule());
    const id = created.data.rule.id;
    expect((await json(w, b.cookie)("GET", "/api/rules")).data.rules).toHaveLength(0);
    expect((await json(w, b.cookie)("GET", `/api/rules/${id}`)).status).toBe(404);
    expect((await json(w, b.cookie)("DELETE", `/api/rules/${id}`)).status).toBe(404);
    expect((await json(w, a.cookie)("GET", `/api/rules/${id}`)).status).toBe(200);
  });

  it("POST /:id/test evaluates against the live forecast and pushes to the user's devices", async () => {
    const w = makeWorld();
    const { cookie } = await signUpAndSignIn(w);
    const api = json(w, cookie);
    await api("POST", "/api/push/subscriptions", {
      subscription: {
        endpoint: "https://push.example/sub1",
        keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
      },
    });
    const { id } = (await api("POST", "/api/rules", sampleRule())).data.rule;

    w.provider.values = { precipitation_probability: 10 };
    const dry = await api("POST", `/api/rules/${id}/test`);
    expect(dry.status).toBe(200);
    expect(dry.data.evaluation.matched).toBe(false);
    expect(dry.data.push).toEqual({ attempted: 1, delivered: 1, failed: 0 });
    expect(w.push.sent[0]?.message.title).toBe("Test: Rain in Berlin");
    expect(w.push.sent[0]?.message.body).toContain("conditions not met");

    w.provider.values = { precipitation_probability: 90 };
    const wet = await api("POST", `/api/rules/${id}/test`);
    expect(wet.data.evaluation.matched).toBe(true);
    expect(wet.data.message).toBe("Precipitation chance >= 60 % in Berlin");
    // testing does not consume the trigger
    expect((await api("GET", `/api/rules/${id}`)).data.rule.armed).toBe(true);
  });
});
