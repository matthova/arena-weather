import { describe, expect, it } from "vitest";
import {
  compare,
  DAY,
  describeCondition,
  describeEvaluation,
  evaluateRule,
  HOUR,
  nextTriggerState,
  samplesInWindow,
} from "./evaluate.js";
import type { Forecast } from "./forecast.js";
import { parseRuleDefinition } from "./rule.js";

// Monday 2025-06-02 12:00:00 UTC
const NOW = Date.UTC(2025, 5, 2, 12, 0, 0) / 1000;
const UTC_OFFSET = 2 * HOUR; // local = UTC+2 -> local hour = utc hour + 2

/** Build a forecast with hourly samples starting at local midnight of "today" for 3 days, and 7 daily samples. */
function makeForecast(
  hourly: Record<string, (i: number, time: number) => number | null>,
  daily: Record<string, (i: number, time: number) => number | null> = {},
): Forecast {
  const localMidnightUtc = NOW - ((NOW + UTC_OFFSET) % DAY); // 2025-06-01T22:00Z
  const hourlyTime: number[] = [];
  for (let i = 0; i < 72; i++) hourlyTime.push(localMidnightUtc + i * HOUR);
  const dailyTime: number[] = [];
  for (let i = 0; i < 7; i++) dailyTime.push(localMidnightUtc + i * DAY);
  const hv: Record<string, (number | null)[]> = {};
  for (const [k, f] of Object.entries(hourly)) hv[k] = hourlyTime.map((t, i) => f(i, t));
  const dv: Record<string, (number | null)[]> = {};
  for (const [k, f] of Object.entries(daily)) dv[k] = dailyTime.map((t, i) => f(i, t));
  return {
    latitude: 52.52,
    longitude: 13.41,
    timezone: "Europe/Berlin",
    utcOffsetSeconds: UTC_OFFSET,
    units: {},
    hourly: { time: hourlyTime, values: hv },
    daily: { time: dailyTime, values: dv },
  };
}

const place = { label: "Berlin", latitude: 52.52, longitude: 13.41 };

describe("compare", () => {
  it("implements every comparator", () => {
    expect(compare(1, "<", 2)).toBe(true);
    expect(compare(2, "<", 2)).toBe(false);
    expect(compare(2, "<=", 2)).toBe(true);
    expect(compare(3, ">", 2)).toBe(true);
    expect(compare(2, ">", 2)).toBe(false);
    expect(compare(2, ">=", 2)).toBe(true);
    expect(compare(2, "==", 2)).toBe(true);
    expect(compare(2, "==", 3)).toBe(false);
    expect(compare(2, "!=", 3)).toBe(true);
    expect(compare(2, "!=", 2)).toBe(false);
  });
});

describe("samplesInWindow", () => {
  it("defaults to the current hour plus the next 24 hours", () => {
    const f = makeForecast({ temperature_2m: (i) => i });
    const s = samplesInWindow(f.hourly, "temperature_2m", "hourly", {}, NOW, UTC_OFFSET);
    // local 14:00 is index 14 (hour containing now), through index 37 (now + 24h exclusive)
    expect(s?.[0]?.value).toBe(14);
    expect(s?.at(-1)?.value).toBe(37);
    expect(s).toHaveLength(24);
  });

  it("honours hoursAhead", () => {
    const f = makeForecast({ temperature_2m: (i) => i });
    const s = samplesInWindow(
      f.hourly,
      "temperature_2m",
      "hourly",
      { window: { hoursAhead: 3 } },
      NOW,
      UTC_OFFSET,
    );
    expect(s?.map((x) => x.value)).toEqual([14, 15, 16]);
  });

  it("filters by local hour of day, including wrap past midnight", () => {
    const f = makeForecast({ temperature_2m: (i) => i });
    const s = samplesInWindow(
      f.hourly,
      "temperature_2m",
      "hourly",
      { window: { hoursAhead: 24, hoursOfDay: { from: 22, to: 1 } } },
      NOW,
      UTC_OFFSET,
    );
    // local hours 22,23 today (index 22,23) and 0,1 tomorrow (index 24,25)
    expect(s?.map((x) => x.value)).toEqual([22, 23, 24, 25]);
  });

  it("skips null samples and returns null for a missing variable", () => {
    const f = makeForecast({ temperature_2m: (i) => (i % 2 ? null : i) });
    const s = samplesInWindow(f.hourly, "temperature_2m", "hourly", {}, NOW, UTC_OFFSET);
    expect(s?.every((x) => x.value % 2 === 0)).toBe(true);
    expect(samplesInWindow(f.hourly, "rain", "hourly", {}, NOW, UTC_OFFSET)).toBeNull();
  });

  it("daily: today counts as day 1 and daysAhead limits it", () => {
    const f = makeForecast({}, { temperature_2m_max: (i) => i });
    const all = samplesInWindow(f.daily, "temperature_2m_max", "daily", {}, NOW, UTC_OFFSET);
    expect(all?.map((x) => x.value)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const two = samplesInWindow(
      f.daily,
      "temperature_2m_max",
      "daily",
      { window: { daysAhead: 2 } },
      NOW,
      UTC_OFFSET,
    );
    expect(two?.map((x) => x.value)).toEqual([0, 1]);
  });
});

describe("evaluateRule", () => {
  it("matches a single hourly condition with the 'any' quantifier", () => {
    const rule = parseRuleDefinition({
      name: "Rain soon",
      place,
      window: { hoursAhead: 6 },
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
          },
        ],
      },
    });
    // only local hour 17 (index 17) is rainy
    const f = makeForecast({ precipitation_probability: (i) => (i === 17 ? 80 : 10) });
    const r = evaluateRule(rule, f, NOW);
    expect(r.matched).toBe(true);
    const c = r.root.children[0];
    expect(c?.type).toBe("condition");
    if (c?.type === "condition") {
      expect(c.sampleCount).toBe(6);
      expect(c.matchCount).toBe(1);
      expect(c.firstMatch?.value).toBe(80);
    }
    // outside the window -> no match
    const far = makeForecast({ precipitation_probability: (i) => (i === 30 ? 80 : 10) });
    expect(evaluateRule(rule, far, NOW).matched).toBe(false);
  });

  it("'all' quantifier requires every sample to satisfy", () => {
    const rule = parseRuleDefinition({
      name: "Dry all day",
      place,
      window: { hoursAhead: 12 },
      root: {
        type: "group",
        operator: "all",
        children: [
          {
            type: "condition",
            granularity: "hourly",
            variable: "precipitation",
            comparator: "==",
            value: 0,
            quantifier: "all",
          },
        ],
      },
    });
    expect(evaluateRule(rule, makeForecast({ precipitation: () => 0 }), NOW).matched).toBe(true);
    expect(
      evaluateRule(rule, makeForecast({ precipitation: (i) => (i === 20 ? 0.3 : 0) }), NOW).matched,
    ).toBe(false);
  });

  it("evaluates nested all/any groups", () => {
    const rule = parseRuleDefinition({
      name: "Nice evening or stormy",
      place,
      root: {
        type: "group",
        operator: "any",
        children: [
          {
            type: "group",
            operator: "all",
            children: [
              {
                type: "condition",
                granularity: "hourly",
                variable: "temperature_2m",
                comparator: ">=",
                value: 20,
              },
              {
                type: "condition",
                granularity: "hourly",
                variable: "cloud_cover",
                comparator: "<",
                value: 30,
              },
            ],
          },
          {
            type: "condition",
            granularity: "daily",
            variable: "wind_gusts_10m_max",
            comparator: ">",
            value: 80,
          },
        ],
      },
    });
    // warm but cloudy, no storm -> false
    expect(
      evaluateRule(
        rule,
        makeForecast(
          { temperature_2m: () => 25, cloud_cover: () => 90 },
          { wind_gusts_10m_max: () => 20 },
        ),
        NOW,
      ).matched,
    ).toBe(false);
    // warm and clear -> true via the inner all-group
    expect(
      evaluateRule(
        rule,
        makeForecast(
          { temperature_2m: () => 25, cloud_cover: () => 10 },
          { wind_gusts_10m_max: () => 20 },
        ),
        NOW,
      ).matched,
    ).toBe(true);
    // cold but storm on day 5 -> true via the daily condition
    const r = evaluateRule(
      rule,
      makeForecast(
        { temperature_2m: () => 5, cloud_cover: () => 90 },
        { wind_gusts_10m_max: (i) => (i === 4 ? 95 : 20) },
      ),
      NOW,
    );
    expect(r.matched).toBe(true);
    expect(r.root.children[0]?.holds).toBe(false);
    expect(r.root.children[1]?.holds).toBe(true);
  });

  it("a condition on a variable missing from the forecast does not hold", () => {
    const rule = parseRuleDefinition({
      name: "x",
      place,
      root: {
        type: "group",
        operator: "all",
        children: [
          {
            type: "condition",
            granularity: "hourly",
            variable: "uv_index",
            comparator: ">",
            value: 1,
          },
        ],
      },
    });
    const r = evaluateRule(rule, makeForecast({}), NOW);
    expect(r.matched).toBe(false);
    const c = r.root.children[0];
    expect(c?.type === "condition" && c.missingVariable).toBe(true);
  });

  it("accepts a Date as now", () => {
    const rule = parseRuleDefinition({
      name: "x",
      place,
      root: {
        type: "group",
        operator: "all",
        children: [
          {
            type: "condition",
            granularity: "hourly",
            variable: "temperature_2m",
            comparator: ">",
            value: 1,
          },
        ],
      },
    });
    const r = evaluateRule(rule, makeForecast({ temperature_2m: () => 10 }), new Date(NOW * 1000));
    expect(r.evaluatedAt).toBe(NOW);
    expect(r.matched).toBe(true);
  });
});

describe("nextTriggerState", () => {
  it("fires once on becoming true and re-arms on becoming false", () => {
    let s = nextTriggerState({ armed: true }, false);
    expect(s).toEqual({ armed: true, fire: false });
    s = nextTriggerState(s, true);
    expect(s).toEqual({ armed: false, fire: true });
    s = nextTriggerState(s, true); // still true: no second notification
    expect(s).toEqual({ armed: false, fire: false });
    s = nextTriggerState(s, false); // back to false: re-arm
    expect(s).toEqual({ armed: true, fire: false });
    s = nextTriggerState(s, true); // true again: fire again
    expect(s).toEqual({ armed: false, fire: true });
  });
});

describe("describe*", () => {
  it("renders a condition with its unit", () => {
    expect(
      describeCondition({
        variable: "temperature_2m",
        granularity: "hourly",
        comparator: ">",
        value: 30,
      }),
    ).toBe("Temperature (2 m) > 30 °C");
    expect(
      describeCondition({
        variable: "weather_code",
        granularity: "daily",
        comparator: "==",
        value: 95,
      }),
    ).toBe("Weather code (WMO) == 95");
  });

  it("lists the holding conditions and the place", () => {
    const rule = parseRuleDefinition({
      name: "Hot",
      place,
      root: {
        type: "group",
        operator: "all",
        children: [
          {
            type: "condition",
            granularity: "hourly",
            variable: "temperature_2m",
            comparator: ">",
            value: 30,
          },
        ],
      },
    });
    const yes = evaluateRule(rule, makeForecast({ temperature_2m: () => 35 }), NOW);
    expect(describeEvaluation(rule, yes)).toBe("Temperature (2 m) > 30 °C in Berlin");
    const no = evaluateRule(rule, makeForecast({ temperature_2m: () => 5 }), NOW);
    expect(describeEvaluation(rule, no)).toBe("Hot — conditions not met in Berlin");
  });
});
