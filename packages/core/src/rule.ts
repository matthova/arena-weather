import { z } from "zod";
import { DAILY_VARIABLE_NAMES, HOURLY_VARIABLE_NAMES } from "./variables.js";

/** Comparators a condition may use. */
export const COMPARATORS = ["<", "<=", ">", ">=", "==", "!="] as const;
export type Comparator = (typeof COMPARATORS)[number];

export const placeSchema = z.object({
  label: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** IANA timezone of the place, e.g. "Europe/Berlin". Defaults to "auto" (Open-Meteo resolves it). */
  timezone: z.string().trim().min(1).max(100).optional(),
});
export type Place = z.infer<typeof placeSchema>;

/**
 * Which forecast samples a rule looks at, relative to "now".
 * All parts are optional; an absent window means the next 24 hours / next 7 days.
 */
export const timeWindowSchema = z
  .object({
    /** Only consider hourly samples within the next N hours (1..168). Default 24. */
    hoursAhead: z.number().int().min(1).max(168).optional(),
    /** Only consider daily samples within the next N days (1..7, today = 1). Default 7. */
    daysAhead: z.number().int().min(1).max(7).optional(),
    /**
     * Only consider hourly samples whose local hour of day is inside [from, to] (inclusive, 0..23).
     * `from` > `to` wraps past midnight (e.g. 22..6).
     */
    hoursOfDay: z
      .object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(23) })
      .optional(),
  })
  .strict();
export type TimeWindow = z.infer<typeof timeWindowSchema>;

const conditionBase = {
  /** Stable id so builders and results can refer to one condition. */
  id: z.string().min(1).max(64).optional(),
  comparator: z.enum(COMPARATORS),
  value: z.number().finite(),
  /**
   * "any" (default): the condition holds if at least one sample in the window satisfies it.
   * "all": every sample in the window must satisfy it.
   */
  quantifier: z.enum(["any", "all"]).default("any"),
};

export const hourlyConditionSchema = z
  .object({
    type: z.literal("condition"),
    granularity: z.literal("hourly"),
    variable: z.enum(HOURLY_VARIABLE_NAMES),
    ...conditionBase,
  })
  .strict();

export const dailyConditionSchema = z
  .object({
    type: z.literal("condition"),
    granularity: z.literal("daily"),
    variable: z.enum(DAILY_VARIABLE_NAMES),
    ...conditionBase,
  })
  .strict();

export const conditionSchema = z.discriminatedUnion("granularity", [
  hourlyConditionSchema,
  dailyConditionSchema,
]);
export type Condition = z.infer<typeof conditionSchema>;
export type ConditionInput = z.input<typeof conditionSchema>;

export interface ConditionGroup {
  type: "group";
  id?: string;
  /** "all" = every child must hold (AND); "any" = at least one child must hold (OR). */
  operator: "all" | "any";
  children: RuleNode[];
}
export interface ConditionGroupInput {
  type: "group";
  id?: string;
  operator: "all" | "any";
  children: RuleNodeInput[];
}
export type RuleNode = Condition | ConditionGroup;
export type RuleNodeInput = ConditionInput | ConditionGroupInput;

export const MAX_GROUP_DEPTH = 5;
export const MAX_GROUP_CHILDREN = 20;

export const groupSchema: z.ZodType<ConditionGroup, ConditionGroupInput> = z.lazy(() =>
  z
    .object({
      type: z.literal("group"),
      id: z.string().min(1).max(64).optional(),
      operator: z.enum(["all", "any"]),
      children: z.array(ruleNodeSchema).min(1).max(MAX_GROUP_CHILDREN),
    })
    .strict(),
);

export const ruleNodeSchema: z.ZodType<RuleNode, RuleNodeInput> = z.lazy(() =>
  z.union([conditionSchema, groupSchema]),
);

export function groupDepth(node: RuleNode): number {
  if (node.type === "condition") return 0;
  return 1 + Math.max(0, ...node.children.map(groupDepth));
}

/** The rule definition a user authors (no server-side bookkeeping). */
export const ruleDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    place: placeSchema,
    window: timeWindowSchema.optional(),
    root: groupSchema,
  })
  .strict()
  .refine((r) => groupDepth(r.root) <= MAX_GROUP_DEPTH, {
    message: `Groups may be nested at most ${MAX_GROUP_DEPTH} levels deep`,
    path: ["root"],
  });
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;
export type RuleDefinitionInput = z.input<typeof ruleDefinitionSchema>;

/** A stored rule as the API returns it. */
export interface Rule extends RuleDefinition {
  id: string;
  /** Paused rules are kept but never evaluated by the checker. */
  paused: boolean;
  /** Current trigger state: `armed` means the rule will fire the next time it becomes true. */
  armed: boolean;
  lastEvaluatedAt: string | null;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Parse + validate an untrusted rule definition. Throws ZodError on failure. */
export function parseRuleDefinition(input: unknown): RuleDefinition {
  return ruleDefinitionSchema.parse(input);
}

export function safeParseRuleDefinition(input: unknown) {
  return ruleDefinitionSchema.safeParse(input);
}

/** Every condition in a tree, depth first. */
export function collectConditions(node: RuleNode): Condition[] {
  if (node.type === "condition") return [node];
  return node.children.flatMap(collectConditions);
}

/** The distinct hourly / daily variables a rule needs from the forecast provider. */
export function requiredVariables(definition: Pick<RuleDefinition, "root">): {
  hourly: string[];
  daily: string[];
} {
  const hourly = new Set<string>();
  const daily = new Set<string>();
  for (const c of collectConditions(definition.root)) {
    (c.granularity === "hourly" ? hourly : daily).add(c.variable);
  }
  return { hourly: [...hourly], daily: [...daily] };
}
