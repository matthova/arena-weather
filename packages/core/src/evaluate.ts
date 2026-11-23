import type { Forecast, ForecastSeries } from "./forecast.js";
import type { Comparator, Condition, ConditionGroup, RuleDefinition, RuleNode } from "./rule.js";
import { findVariable } from "./variables.js";

export const HOUR = 3600;
export const DAY = 86400;
export const DEFAULT_HOURS_AHEAD = 24;
export const DEFAULT_DAYS_AHEAD = 7;

export interface Sample {
  /** unix seconds */
  time: number;
  value: number;
}

export interface ConditionResult {
  type: "condition";
  id?: string;
  granularity: "hourly" | "daily";
  variable: string;
  comparator: Comparator;
  value: number;
  quantifier: "any" | "all";
  holds: boolean;
  /** Non-null samples inside the window that were considered. */
  sampleCount: number;
  /** How many of them satisfied the comparator. */
  matchCount: number;
  /** The earliest satisfying sample, if any. */
  firstMatch: Sample | null;
  /** Set when the forecast lacks the variable (condition then does not hold). */
  missingVariable?: boolean;
}

export interface GroupResult {
  type: "group";
  id?: string;
  operator: "all" | "any";
  holds: boolean;
  children: NodeResult[];
}

export type NodeResult = ConditionResult | GroupResult;

export interface RuleEvaluation {
  /** Whether the whole rule holds right now. */
  matched: boolean;
  /** unix seconds the evaluation was made for */
  evaluatedAt: number;
  root: GroupResult;
}

export function compare(left: number, comparator: Comparator, right: number): boolean {
  switch (comparator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "==":
      return left === right;
    case "!=":
      return left !== right;
  }
}

function toUnixSeconds(now: Date | number): number {
  return typeof now === "number" ? Math.floor(now) : Math.floor(now.getTime() / 1000);
}

function localHourOfDay(time: number, utcOffsetSeconds: number): number {
  const local = time + utcOffsetSeconds;
  return Math.floor((((local % DAY) + DAY) % DAY) / HOUR);
}

function hourInRange(hour: number, from: number, to: number): boolean {
  return from <= to ? hour >= from && hour <= to : hour >= from || hour <= to;
}

/**
 * The samples of `variable` in `series` that fall inside the rule's time window.
 * Hourly: samples whose hour contains `now` or lies within the next `hoursAhead` hours,
 * optionally filtered by local hour of day. Daily: today plus the next `daysAhead - 1` days.
 */
export function samplesInWindow(
  series: ForecastSeries,
  variable: string,
  granularity: "hourly" | "daily",
  definition: Pick<RuleDefinition, "window">,
  now: number,
  utcOffsetSeconds: number,
): Sample[] | null {
  const values = series.values[variable];
  if (!values) return null;
  const window = definition.window ?? {};
  const out: Sample[] = [];
  const step = granularity === "hourly" ? HOUR : DAY;
  // hourly windows run from now; daily windows run from the start of the local day ("today" = day 1)
  const localDayStart = now - ((((now + utcOffsetSeconds) % DAY) + DAY) % DAY);
  const end =
    granularity === "hourly"
      ? now + (window.hoursAhead ?? DEFAULT_HOURS_AHEAD) * HOUR
      : localDayStart + (window.daysAhead ?? DEFAULT_DAYS_AHEAD) * DAY;
  const hoursOfDay = granularity === "hourly" ? window.hoursOfDay : undefined;

  for (let i = 0; i < series.time.length; i++) {
    const time = series.time[i];
    const value = values[i];
    if (time === undefined || value === null || value === undefined || Number.isNaN(value))
      continue;
    // sample is current if its interval [time, time+step) contains now
    if (time + step <= now) continue;
    if (time >= end) break;
    if (
      hoursOfDay &&
      !hourInRange(localHourOfDay(time, utcOffsetSeconds), hoursOfDay.from, hoursOfDay.to)
    ) {
      continue;
    }
    out.push({ time, value });
  }
  return out;
}

export function evaluateCondition(
  condition: Condition,
  forecast: Forecast,
  definition: Pick<RuleDefinition, "window">,
  now: number,
): ConditionResult {
  const series = condition.granularity === "hourly" ? forecast.hourly : forecast.daily;
  const base = {
    type: "condition" as const,
    id: condition.id,
    granularity: condition.granularity,
    variable: condition.variable,
    comparator: condition.comparator,
    value: condition.value,
    quantifier: condition.quantifier,
  };
  const samples = samplesInWindow(
    series,
    condition.variable,
    condition.granularity,
    definition,
    now,
    forecast.utcOffsetSeconds,
  );
  if (samples === null) {
    return {
      ...base,
      holds: false,
      sampleCount: 0,
      matchCount: 0,
      firstMatch: null,
      missingVariable: true,
    };
  }
  let matchCount = 0;
  let firstMatch: Sample | null = null;
  for (const s of samples) {
    if (compare(s.value, condition.comparator, condition.value)) {
      matchCount++;
      if (!firstMatch) firstMatch = s;
    }
  }
  const holds =
    samples.length > 0 &&
    (condition.quantifier === "all" ? matchCount === samples.length : matchCount > 0);
  return { ...base, holds, sampleCount: samples.length, matchCount, firstMatch };
}

export function evaluateNode(
  node: RuleNode,
  forecast: Forecast,
  definition: Pick<RuleDefinition, "window">,
  now: number,
): NodeResult {
  if (node.type === "condition") return evaluateCondition(node, forecast, definition, now);
  return evaluateGroup(node, forecast, definition, now);
}

export function evaluateGroup(
  group: ConditionGroup,
  forecast: Forecast,
  definition: Pick<RuleDefinition, "window">,
  now: number,
): GroupResult {
  const children = group.children.map((c) => evaluateNode(c, forecast, definition, now));
  const holds =
    group.operator === "all" ? children.every((c) => c.holds) : children.some((c) => c.holds);
  return { type: "group", id: group.id, operator: group.operator, holds, children };
}

/** Pure: evaluate a rule definition against a forecast at time `now`. */
export function evaluateRule(
  definition: RuleDefinition,
  forecast: Forecast,
  now: Date | number = Date.now() / 1000,
): RuleEvaluation {
  const evaluatedAt = toUnixSeconds(now);
  const root = evaluateGroup(definition.root, forecast, definition, evaluatedAt);
  return { matched: root.holds, evaluatedAt, root };
}

// --- Firing state -------------------------------------------------------------

export interface TriggerState {
  /** `true` = the rule fires the next time its evaluation is true. */
  armed: boolean;
}

export interface TriggerTransition extends TriggerState {
  /** Send a notification now. */
  fire: boolean;
}

/**
 * A rule fires once when it becomes true and re-arms once it becomes false again.
 * Pure: previous state + current evaluation -> new state + whether to fire.
 */
export function nextTriggerState(previous: TriggerState, matched: boolean): TriggerTransition {
  if (matched) {
    return previous.armed ? { armed: false, fire: true } : { armed: false, fire: false };
  }
  return { armed: true, fire: false };
}

// --- Human text ---------------------------------------------------------------

export function describeCondition(condition: {
  variable: string;
  granularity: "hourly" | "daily";
  comparator: Comparator;
  value: number;
}): string {
  const v = findVariable(condition.variable, condition.granularity);
  const label = v?.label ?? condition.variable;
  const unit = v && v.unit !== "code" && v.unit !== "0/1" && v.unit !== "index" ? ` ${v.unit}` : "";
  return `${label} ${condition.comparator} ${condition.value}${unit}`;
}

/** Short text for a notification: the conditions that currently hold. */
export function describeEvaluation(definition: RuleDefinition, evaluation: RuleEvaluation): string {
  const holding: string[] = [];
  const walk = (n: NodeResult) => {
    if (n.type === "condition") {
      if (n.holds) holding.push(describeCondition(n));
    } else n.children.forEach(walk);
  };
  walk(evaluation.root);
  const where = definition.place.label;
  if (holding.length === 0) return `${definition.name} — conditions not met in ${where}`;
  return `${holding.join("; ")} in ${where}`;
}
