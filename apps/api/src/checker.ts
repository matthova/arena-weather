import {
  describeEvaluation,
  evaluateRule,
  nextTriggerState,
  type RuleEvaluation,
  requiredVariables,
} from "@arena-weather/core";
import type { StoredRule } from "./db/repo.js";
import { notifyUser } from "./notify.js";
import type { Services } from "./services.js";

export interface CheckerSummary {
  startedAt: string;
  evaluated: number;
  matched: number;
  fired: number;
  errors: { ruleId: string; error: string }[];
  durationMs: number;
}

/** Fetch the forecast a rule needs and evaluate it. Shared by the cron checker and "test this rule". */
export async function evaluateStoredRule(
  services: Services,
  rule: StoredRule,
  now: number,
): Promise<RuleEvaluation> {
  const vars = requiredVariables(rule);
  const forecast = await services.provider.forecast({
    latitude: rule.place.latitude,
    longitude: rule.place.longitude,
    timezone: rule.place.timezone,
    hourly: vars.hourly,
    daily: vars.daily,
    forecastDays: 8, // 7 days ahead needs today + 7 when the window spans a week
  });
  return evaluateRule(rule, forecast, now);
}

export function ruleMessage(services: Services, rule: StoredRule, evaluation: RuleEvaluation) {
  return {
    title: rule.name,
    body: describeEvaluation(rule, evaluation),
    url: `${services.env.APP_URL.replace(/\/$/, "")}/rules/${rule.id}`,
    tag: `rule-${rule.id}`,
    data: { ruleId: rule.id, matched: evaluation.matched },
  };
}

/** The 15-minute job: evaluate every active rule, fire the ones that just became true. */
export async function runChecker(
  services: Services,
  now = Date.now() / 1000,
): Promise<CheckerSummary> {
  const started = Date.now();
  const summary: CheckerSummary = {
    startedAt: new Date(started).toISOString(),
    evaluated: 0,
    matched: 0,
    fired: 0,
    errors: [],
    durationMs: 0,
  };
  const rules = await services.repo.rules.listActive();
  for (const rule of rules) {
    try {
      const evaluation = await evaluateStoredRule(services, rule, now);
      summary.evaluated++;
      if (evaluation.matched) summary.matched++;
      const next = nextTriggerState({ armed: rule.armed }, evaluation.matched);
      if (next.fire) {
        summary.fired++;
        await notifyUser(services, rule.userId, ruleMessage(services, rule, evaluation), {
          ruleId: rule.id,
          kind: "alert",
        });
      }
      await services.repo.rules.recordEvaluation(rule.id, {
        armed: next.armed,
        fired: next.fire,
        error: null,
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      summary.errors.push({ ruleId: rule.id, error });
      console.error(`rule ${rule.id} failed`, e);
      // keep the trigger state; just note the error
      await services.repo.rules.recordEvaluation(rule.id, {
        armed: rule.armed,
        fired: false,
        error,
      });
    }
  }
  summary.durationMs = Date.now() - started;
  console.log("checker", JSON.stringify(summary));
  return summary;
}
