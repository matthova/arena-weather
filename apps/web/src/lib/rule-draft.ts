import {
  type Comparator,
  type Condition,
  type ConditionGroup,
  DAILY_VARIABLES,
  describeCondition,
  findVariable,
  type Granularity,
  HOURLY_VARIABLES,
  type Place,
  type RuleDefinition,
  type RuleDefinitionInput,
  type RuleNode,
  type RuleNodeInput,
  safeParseRuleDefinition,
} from "@arena-weather/core";

/**
 * The rule builder's editable state. It mirrors the core rule JSON but keeps text fields as text
 * (so half-typed numbers do not fight the user) and gives every node a stable key for React.
 * `toDefinition` is the only way out: it produces the shared core JSON, validated by core's schema.
 */
export interface ConditionDraft {
  kind: "condition";
  key: string;
  granularity: Granularity;
  variable: string;
  comparator: Comparator;
  value: string;
  quantifier: "any" | "all";
}
export interface GroupDraft {
  kind: "group";
  key: string;
  operator: "all" | "any";
  children: NodeDraft[];
}
export type NodeDraft = ConditionDraft | GroupDraft;

export interface WindowDraft {
  hoursAhead: string;
  daysAhead: string;
  useHoursOfDay: boolean;
  hoursFrom: string;
  hoursTo: string;
}

export interface RuleDraft {
  name: string;
  place: Place | null;
  window: WindowDraft;
  root: GroupDraft;
}

let counter = 0;
export function newKey(prefix = "n"): string {
  counter += 1;
  return `${prefix}${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newCondition(
  partial: Partial<Omit<ConditionDraft, "kind" | "key">> = {},
): ConditionDraft {
  return {
    kind: "condition",
    key: newKey("c"),
    granularity: "hourly",
    variable: "precipitation_probability",
    comparator: ">=",
    value: "60",
    quantifier: "any",
    ...partial,
  };
}

export function newGroup(
  operator: "all" | "any" = "all",
  children: NodeDraft[] = [newCondition()],
): GroupDraft {
  return { kind: "group", key: newKey("g"), operator, children };
}

export function emptyWindow(): WindowDraft {
  return { hoursAhead: "", daysAhead: "", useHoursOfDay: false, hoursFrom: "8", hoursTo: "20" };
}

export function emptyDraft(place: Place | null = null): RuleDraft {
  return { name: "", place, window: emptyWindow(), root: newGroup("all") };
}

// --- Rule JSON -> draft ----------------------------------------------------------

function nodeToDraft(node: RuleNode | RuleNodeInput): NodeDraft {
  if (node.type === "group")
    return {
      kind: "group",
      key: newKey("g"),
      operator: node.operator,
      children: node.children.map(nodeToDraft),
    };
  return {
    kind: "condition",
    key: newKey("c"),
    granularity: node.granularity,
    variable: node.variable,
    comparator: node.comparator,
    value: String(node.value),
    quantifier: node.quantifier ?? "any",
  };
}

export function draftFromDefinition(def: RuleDefinition | RuleDefinitionInput): RuleDraft {
  const root = nodeToDraft(def.root);
  const w = def.window ?? {};
  return {
    name: def.name,
    place: def.place,
    window: {
      hoursAhead: w.hoursAhead !== undefined ? String(w.hoursAhead) : "",
      daysAhead: w.daysAhead !== undefined ? String(w.daysAhead) : "",
      useHoursOfDay: w.hoursOfDay !== undefined,
      hoursFrom: w.hoursOfDay ? String(w.hoursOfDay.from) : "8",
      hoursTo: w.hoursOfDay ? String(w.hoursOfDay.to) : "20",
    },
    root: root.kind === "group" ? root : newGroup("all", [root]),
  };
}

// --- Draft -> rule JSON ----------------------------------------------------------

export interface DraftErrors {
  /** Form-level messages. */
  messages: string[];
  /** Per node key. */
  nodes: Record<string, string>;
}

function parseNumber(s: string): number | undefined {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function nodeToInput(node: NodeDraft, errors: DraftErrors): RuleNodeInput {
  if (node.kind === "group") {
    if (node.children.length === 0)
      errors.nodes[node.key] = "Add at least one condition to this group";
    return {
      type: "group",
      operator: node.operator,
      children: node.children.map((c) => nodeToInput(c, errors)),
    };
  }
  const value = parseNumber(node.value);
  if (value === undefined) errors.nodes[node.key] = "Enter a number";
  if (!findVariable(node.variable, node.granularity)) errors.nodes[node.key] = "Pick a variable";
  return {
    type: "condition",
    granularity: node.granularity,
    variable: node.variable,
    comparator: node.comparator,
    value: value ?? Number.NaN,
    quantifier: node.quantifier,
  } as RuleNodeInput;
}

export type ToDefinitionResult =
  | { ok: true; definition: RuleDefinition }
  | { ok: false; errors: DraftErrors };

/** Serializes the draft to the shared rule JSON (validated with the core schema). */
export function toDefinition(draft: RuleDraft): ToDefinitionResult {
  const errors: DraftErrors = { messages: [], nodes: {} };
  if (!draft.name.trim()) errors.messages.push("Give the rule a name");
  if (!draft.place) errors.messages.push("Pick a place");

  const window: NonNullable<RuleDefinitionInput["window"]> = {};
  const hoursAhead = parseNumber(draft.window.hoursAhead);
  if (draft.window.hoursAhead.trim() !== "") {
    if (hoursAhead === undefined) errors.messages.push("Hours ahead must be a number");
    else window.hoursAhead = hoursAhead;
  }
  const daysAhead = parseNumber(draft.window.daysAhead);
  if (draft.window.daysAhead.trim() !== "") {
    if (daysAhead === undefined) errors.messages.push("Days ahead must be a number");
    else window.daysAhead = daysAhead;
  }
  if (draft.window.useHoursOfDay) {
    const from = parseNumber(draft.window.hoursFrom);
    const to = parseNumber(draft.window.hoursTo);
    if (from === undefined || to === undefined)
      errors.messages.push("Hours of day must be numbers (0–23)");
    else window.hoursOfDay = { from, to };
  }

  const rootInput = nodeToInput(draft.root, errors);
  const input: RuleDefinitionInput = {
    name: draft.name.trim(),
    place: draft.place ?? { label: "?", latitude: 0, longitude: 0 },
    ...(Object.keys(window).length ? { window } : {}),
    root: rootInput as RuleDefinitionInput["root"],
  };
  if (errors.messages.length || Object.keys(errors.nodes).length) return { ok: false, errors };

  const parsed = safeParseRuleDefinition(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String);
      const node = nodeAtPath(draft.root, path);
      if (node) errors.nodes[node.key] = issue.message;
      else errors.messages.push(`${path.join(".") || "rule"}: ${issue.message}`);
    }
    return { ok: false, errors };
  }
  return { ok: true, definition: parsed.data };
}

/** Follows a zod issue path like ["root","children","1","children","0","value"] into the draft tree. */
function nodeAtPath(root: GroupDraft, path: string[]): NodeDraft | null {
  if (path[0] !== "root") return null;
  let node: NodeDraft = root;
  let i = 1;
  while (i < path.length) {
    if (path[i] === "children" && node.kind === "group") {
      const idx = Number(path[i + 1]);
      const child: NodeDraft | undefined = node.children[idx];
      if (!child) return node;
      node = child;
      i += 2;
    } else break;
  }
  return node;
}

// --- Tree edits (immutable) ----------------------------------------------------

export function updateNode(
  root: GroupDraft,
  key: string,
  fn: (n: NodeDraft) => NodeDraft,
): GroupDraft {
  const visit = (n: NodeDraft): NodeDraft => {
    if (n.key === key) return fn(n);
    if (n.kind === "group") return { ...n, children: n.children.map(visit) };
    return n;
  };
  const out = visit(root);
  return out.kind === "group" ? out : root;
}

export function removeNode(root: GroupDraft, key: string): GroupDraft {
  const visit = (n: GroupDraft): GroupDraft => ({
    ...n,
    children: n.children
      .filter((c) => c.key !== key)
      .map((c) => (c.kind === "group" ? visit(c) : c)),
  });
  return visit(root);
}

export function addChild(root: GroupDraft, groupKey: string, child: NodeDraft): GroupDraft {
  return updateNode(root, groupKey, (n) =>
    n.kind === "group" ? { ...n, children: [...n.children, child] } : n,
  );
}

// --- Display -----------------------------------------------------------------------

export const COMPARATOR_LABELS: Record<Comparator, string> = {
  "<": "below",
  "<=": "at most",
  ">": "above",
  ">=": "at least",
  "==": "equal to",
  "!=": "not",
};

export function variablesFor(granularity: Granularity) {
  return granularity === "hourly" ? HOURLY_VARIABLES : DAILY_VARIABLES;
}

/** "Precipitation chance >= 60 % and (Wind gusts > 50 km/h or Weather code == 95)" */
export function describeRule(node: RuleNode | Condition | ConditionGroup, top = true): string {
  if (node.type === "condition") return describeCondition(node);
  const joiner = node.operator === "all" ? " and " : " or ";
  const inner = node.children.map((c) => describeRule(c, false)).join(joiner);
  return top || node.children.length < 2 ? inner : `(${inner})`;
}

export function describeWindow(window: RuleDefinition["window"]): string {
  if (!window) return "next 24 h / 7 days";
  const parts: string[] = [];
  if (window.hoursAhead) parts.push(`next ${window.hoursAhead} h`);
  if (window.daysAhead) parts.push(`next ${window.daysAhead} d`);
  if (window.hoursOfDay) parts.push(`${window.hoursOfDay.from}:00–${window.hoursOfDay.to}:59`);
  return parts.join(", ") || "next 24 h / 7 days";
}
