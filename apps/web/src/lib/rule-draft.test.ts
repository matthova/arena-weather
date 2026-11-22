import { parseRuleDefinition } from "@arena-weather/core";
import { describe, expect, it } from "vitest";
import {
  addChild,
  describeRule,
  describeWindow,
  draftFromDefinition,
  emptyDraft,
  newCondition,
  newGroup,
  removeNode,
  toDefinition,
  updateNode,
} from "./rule-draft";

const berlin = { label: "Berlin", latitude: 52.52, longitude: 13.41, timezone: "Europe/Berlin" };

describe("rule draft -> shared rule JSON", () => {
  it("reports what is missing instead of producing JSON", () => {
    const r = toDefinition(emptyDraft());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.messages).toEqual(["Give the rule a name", "Pick a place"]);
  });

  it("serializes nested all/any groups to the core schema", () => {
    const inner = newGroup("any", [
      newCondition({ variable: "wind_gusts_10m", comparator: ">", value: "50" }),
      newCondition({ granularity: "daily", variable: "weather_code", comparator: "==", value: "95" }),
    ]);
    let root = newGroup("all", [newCondition({ variable: "precipitation_probability", comparator: ">=", value: "60" })]);
    root = addChild(root, root.key, inner);
    const draft = {
      ...emptyDraft(berlin),
      name: "Wet and windy evening",
      root,
      window: { hoursAhead: "12", daysAhead: "", useHoursOfDay: true, hoursFrom: "17", hoursTo: "22" },
    };
    const r = toDefinition(draft);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.definition).toEqual({
      name: "Wet and windy evening",
      place: berlin,
      window: { hoursAhead: 12, hoursOfDay: { from: 17, to: 22 } },
      root: {
        type: "group",
        operator: "all",
        children: [
          {
            type: "condition",
            granularity: "hourly",
            variable: "precipitation_probability",
            comparator: ">=",
            value: 60,
            quantifier: "any",
          },
          {
            type: "group",
            operator: "any",
            children: [
              {
                type: "condition",
                granularity: "hourly",
                variable: "wind_gusts_10m",
                comparator: ">",
                value: 50,
                quantifier: "any",
              },
              {
                type: "condition",
                granularity: "daily",
                variable: "weather_code",
                comparator: "==",
                value: 95,
                quantifier: "any",
              },
            ],
          },
        ],
      },
    });
    // and it is exactly what the API accepts
    expect(() => parseRuleDefinition(r.definition)).not.toThrow();
  });

  it("round-trips a stored rule through the draft", () => {
    const definition = parseRuleDefinition({
      name: "Frost tonight",
      place: berlin,
      window: { hoursAhead: 10, hoursOfDay: { from: 22, to: 6 } },
      root: {
        type: "group",
        operator: "any",
        children: [
          { type: "condition", granularity: "hourly", variable: "temperature_2m", comparator: "<=", value: 0 },
          {
            type: "group",
            operator: "all",
            children: [
              { type: "condition", granularity: "daily", variable: "temperature_2m_min", comparator: "<", value: 2, quantifier: "all" },
            ],
          },
        ],
      },
    });
    const back = toDefinition(draftFromDefinition(definition));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.definition).toEqual(definition);
  });

  it("points at the node with a bad value", () => {
    const bad = newCondition({ value: "lots" });
    const draft = { ...emptyDraft(berlin), name: "x", root: newGroup("all", [bad]) };
    const r = toDefinition(draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.nodes[bad.key]).toBe("Enter a number");
  });

  it("surfaces schema errors from core on the right node", () => {
    const c = newCondition({ value: "1" });
    const draft = {
      ...emptyDraft(berlin),
      name: "x",
      root: newGroup("all", [c]),
      window: { hoursAhead: "500", daysAhead: "", useHoursOfDay: false, hoursFrom: "", hoursTo: "" },
    };
    const r = toDefinition(draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.messages.join(" ")).toMatch(/window\.hoursAhead/);
  });

  it("edits the tree immutably", () => {
    const a = newCondition({ value: "1" });
    const g = newGroup("any", [newCondition({ value: "2" })]);
    const root = newGroup("all", [a, g]);
    const updated = updateNode(root, a.key, (n) => (n.kind === "condition" ? { ...n, value: "9" } : n));
    expect(updated).not.toBe(root);
    expect(updated.children[0]).toMatchObject({ value: "9" });
    expect(root.children[0]).toMatchObject({ value: "1" });
    const removed = removeNode(updated, g.key);
    expect(removed.children).toHaveLength(1);
  });

  it("describes rules and windows for the list", () => {
    const def = parseRuleDefinition({
      name: "n",
      place: berlin,
      root: {
        type: "group",
        operator: "all",
        children: [
          { type: "condition", granularity: "hourly", variable: "precipitation_probability", comparator: ">=", value: 60 },
          {
            type: "group",
            operator: "any",
            children: [
              { type: "condition", granularity: "hourly", variable: "wind_gusts_10m", comparator: ">", value: 50 },
              { type: "condition", granularity: "daily", variable: "weather_code", comparator: "==", value: 95 },
            ],
          },
        ],
      },
    });
    expect(describeRule(def.root)).toBe(
      "Precipitation chance >= 60 % and (Wind gusts (10 m) > 50 km/h or Weather code (WMO) == 95)",
    );
    expect(describeWindow(undefined)).toBe("next 24 h / 7 days");
    expect(describeWindow({ hoursAhead: 12, hoursOfDay: { from: 17, to: 22 } })).toBe("next 12 h, 17:00–22:59");
  });
});
