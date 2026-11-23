import { describe, expect, it } from "vitest";
import {
  collectConditions,
  groupDepth,
  MAX_GROUP_DEPTH,
  parseRuleDefinition,
  requiredVariables,
  safeParseRuleDefinition,
} from "./rule.js";
import { DAILY_VARIABLES, findVariable, HOURLY_VARIABLES, VARIABLES } from "./variables.js";

const place = { label: "Berlin", latitude: 52.52, longitude: 13.41 };
const cond = (variable: string, granularity: "hourly" | "daily" = "hourly") => ({
  type: "condition" as const,
  granularity,
  variable,
  comparator: ">" as const,
  value: 1,
});

describe("ruleDefinitionSchema", () => {
  it("parses a valid rule and applies defaults", () => {
    const r = parseRuleDefinition({
      name: "  Rain  ",
      place,
      root: { type: "group", operator: "all", children: [cond("rain")] },
    });
    expect(r.name).toBe("Rain");
    const c = r.root.children[0];
    expect(c?.type === "condition" && c.quantifier).toBe("any");
  });

  it("rejects unknown variables and mismatched granularity", () => {
    expect(
      safeParseRuleDefinition({
        name: "x",
        place,
        root: { type: "group", operator: "all", children: [cond("nope")] },
      }).success,
    ).toBe(false);
    // temperature_2m_max is daily only
    expect(
      safeParseRuleDefinition({
        name: "x",
        place,
        root: { type: "group", operator: "all", children: [cond("temperature_2m_max", "hourly")] },
      }).success,
    ).toBe(false);
    expect(
      safeParseRuleDefinition({
        name: "x",
        place,
        root: { type: "group", operator: "all", children: [cond("temperature_2m_max", "daily")] },
      }).success,
    ).toBe(true);
  });

  it("rejects bad comparators, coordinates, empty groups and unknown keys", () => {
    const base = { name: "x", place };
    expect(
      safeParseRuleDefinition({
        ...base,
        root: { type: "group", operator: "all", children: [{ ...cond("rain"), comparator: "~" }] },
      }).success,
    ).toBe(false);
    expect(
      safeParseRuleDefinition({
        ...base,
        place: { ...place, latitude: 91 },
        root: { type: "group", operator: "all", children: [cond("rain")] },
      }).success,
    ).toBe(false);
    expect(
      safeParseRuleDefinition({ ...base, root: { type: "group", operator: "all", children: [] } })
        .success,
    ).toBe(false);
    expect(
      safeParseRuleDefinition({
        ...base,
        root: { type: "group", operator: "all", children: [cond("rain")], extra: 1 },
      }).success,
    ).toBe(false);
  });

  it("validates the time window", () => {
    const base = {
      name: "x",
      place,
      root: { type: "group", operator: "all", children: [cond("rain")] },
    };
    expect(safeParseRuleDefinition({ ...base, window: { hoursAhead: 48 } }).success).toBe(true);
    expect(safeParseRuleDefinition({ ...base, window: { hoursAhead: 0 } }).success).toBe(false);
    expect(safeParseRuleDefinition({ ...base, window: { daysAhead: 8 } }).success).toBe(false);
    expect(
      safeParseRuleDefinition({ ...base, window: { hoursOfDay: { from: 7, to: 25 } } }).success,
    ).toBe(false);
  });

  it("limits nesting depth", () => {
    let node: unknown = cond("rain");
    for (let i = 0; i < MAX_GROUP_DEPTH; i++)
      node = { type: "group", operator: "all", children: [node] };
    expect(safeParseRuleDefinition({ name: "x", place, root: node }).success).toBe(true);
    node = { type: "group", operator: "all", children: [node] };
    expect(safeParseRuleDefinition({ name: "x", place, root: node }).success).toBe(false);
  });
});

describe("helpers", () => {
  const rule = parseRuleDefinition({
    name: "x",
    place,
    root: {
      type: "group",
      operator: "any",
      children: [
        cond("rain"),
        { type: "group", operator: "all", children: [cond("rain"), cond("uv_index_max", "daily")] },
      ],
    },
  });
  it("collects conditions and required variables", () => {
    expect(collectConditions(rule.root)).toHaveLength(3);
    expect(requiredVariables(rule)).toEqual({ hourly: ["rain"], daily: ["uv_index_max"] });
    expect(groupDepth(rule.root)).toBe(2);
  });
});

describe("variables", () => {
  it("has unique names per granularity and findable entries", () => {
    const h = new Set(HOURLY_VARIABLES.map((v) => v.name));
    const d = new Set(DAILY_VARIABLES.map((v) => v.name));
    expect(h.size).toBe(HOURLY_VARIABLES.length);
    expect(d.size).toBe(DAILY_VARIABLES.length);
    expect(VARIABLES.length).toBe(h.size + d.size);
    expect(findVariable("temperature_2m", "hourly")?.unit).toBe("°C");
    expect(findVariable("temperature_2m", "daily")).toBeUndefined();
  });
});
