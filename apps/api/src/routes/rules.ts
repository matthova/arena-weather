import { ruleDefinitionSchema } from "@arena-weather/core";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { evaluateStoredRule, ruleMessage } from "../checker.js";
import { publicRule } from "../db/repo.js";
import { badRequest, notFound } from "../lib/http.js";
import { requireAuth } from "../middleware.js";
import { notifyUser } from "../notify.js";

const MAX_RULES_PER_USER = 100;

const body = zValidator("json", ruleDefinitionSchema, (r) => {
  if (!r.success) throw badRequest("Invalid rule", r.error.issues);
});

export const rulesRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const rules = await c.get("services").repo.rules.listByUser(c.get("userId"));
    return c.json({ rules: rules.map(publicRule) });
  })
  .post("/", body, async (c) => {
    const { repo } = c.get("services");
    const userId = c.get("userId");
    const existing = await repo.rules.listByUser(userId);
    if (existing.length >= MAX_RULES_PER_USER)
      throw badRequest(`At most ${MAX_RULES_PER_USER} rules`);
    const rule = await repo.rules.create(userId, c.req.valid("json"));
    return c.json({ rule: publicRule(rule) }, 201);
  })
  .get("/:id", async (c) => {
    const rule = await c.get("services").repo.rules.get(c.req.param("id"), c.get("userId"));
    if (!rule) throw notFound("Rule");
    return c.json({ rule: publicRule(rule) });
  })
  .put("/:id", body, async (c) => {
    const rule = await c
      .get("services")
      .repo.rules.update(c.req.param("id"), c.get("userId"), c.req.valid("json"));
    if (!rule) throw notFound("Rule");
    return c.json({ rule: publicRule(rule) });
  })
  .delete("/:id", async (c) => {
    const ok = await c.get("services").repo.rules.delete(c.req.param("id"), c.get("userId"));
    if (!ok) throw notFound("Rule");
    return c.body(null, 204);
  })
  .post("/:id/pause", async (c) => {
    const rule = await c
      .get("services")
      .repo.rules.setPaused(c.req.param("id"), c.get("userId"), true);
    if (!rule) throw notFound("Rule");
    return c.json({ rule: publicRule(rule) });
  })
  .post("/:id/resume", async (c) => {
    const rule = await c
      .get("services")
      .repo.rules.setPaused(c.req.param("id"), c.get("userId"), false);
    if (!rule) throw notFound("Rule");
    return c.json({ rule: publicRule(rule) });
  })
  /** Evaluate now against a live forecast and push the result to the caller's devices, whatever the trigger state. */
  .post("/:id/test", async (c) => {
    const services = c.get("services");
    const userId = c.get("userId");
    const rule = await services.repo.rules.get(c.req.param("id"), userId);
    if (!rule) throw notFound("Rule");
    const evaluation = await evaluateStoredRule(services, rule, Date.now() / 1000);
    const message = ruleMessage(services, rule, evaluation);
    message.title = `Test: ${message.title}`;
    const push = await notifyUser(services, userId, message, { ruleId: rule.id, kind: "test" });
    return c.json({ rule: publicRule(rule), evaluation, message: message.body, push });
  });
