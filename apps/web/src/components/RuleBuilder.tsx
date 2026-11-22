import { COMPARATORS, findVariable, type Place, type RuleDefinition } from "@arena-weather/core";
import { type FormEvent, useState } from "react";
import { PlaceSearch } from "~/components/PlaceSearch";
import {
  addChild,
  COMPARATOR_LABELS,
  type ConditionDraft,
  type DraftErrors,
  type GroupDraft,
  type NodeDraft,
  newCondition,
  newGroup,
  type RuleDraft,
  removeNode,
  toDefinition,
  updateNode,
  variablesFor,
} from "~/lib/rule-draft";

export function RuleBuilder({
  initial,
  onSave,
  saving,
  saveLabel = "Save rule",
  serverError,
}: {
  initial: RuleDraft;
  onSave: (definition: RuleDefinition) => void;
  saving?: boolean;
  saveLabel?: string;
  serverError?: string | null;
}) {
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [errors, setErrors] = useState<DraftErrors>({ messages: [], nodes: {} });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = toDefinition(draft);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({ messages: [], nodes: {} });
    onSave(r.definition);
  };

  const setRoot = (root: GroupDraft) => setDraft((d) => ({ ...d, root }));
  const setWindow = (patch: Partial<RuleDraft["window"]>) =>
    setDraft((d) => ({ ...d, window: { ...d.window, ...patch } }));

  return (
    <form className="stack" onSubmit={submit} data-testid="rule-builder">
      <section className="card stack">
        <div className="field">
          <label htmlFor="rule-name">Name</label>
          <input
            id="rule-name"
            className="input"
            placeholder="e.g. Wet and windy evening"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="field">
          <span className="label">Place</span>
          {draft.place ? (
            <div className="row between notice">
              <span>
                <strong>{draft.place.label}</strong>{" "}
                <span className="muted small">
                  {draft.place.latitude.toFixed(2)}, {draft.place.longitude.toFixed(2)}
                  {draft.place.timezone ? ` · ${draft.place.timezone}` : ""}
                </span>
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={() => setDraft({ ...draft, place: null })}
              >
                Change
              </button>
            </div>
          ) : (
            <PlaceSearch
              onSelect={(place: Place) => setDraft({ ...draft, place })}
              placeholder="Search a place for this rule…"
            />
          )}
        </div>
      </section>

      <section className="card">
        <h2>Conditions</h2>
        <p className="muted small">
          A condition holds when any forecast sample in the window satisfies it. Nest groups to mix
          "all of" and "any of".
        </p>
        <GroupEditor
          group={draft.root}
          root={draft.root}
          setRoot={setRoot}
          errors={errors.nodes}
          depth={0}
        />
      </section>

      <section className="card">
        <h2>Time window</h2>
        <p className="muted small">
          Optional. Without it the rule looks at the next 24 hours (hourly) and the next 7 days
          (daily).
        </p>
        <div className="window-grid">
          <div className="field">
            <label htmlFor="hours-ahead">Hours ahead (1–168)</label>
            <input
              id="hours-ahead"
              className="input"
              inputMode="numeric"
              placeholder="24"
              value={draft.window.hoursAhead}
              onChange={(e) => setWindow({ hoursAhead: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="days-ahead">Days ahead (1–7)</label>
            <input
              id="days-ahead"
              className="input"
              inputMode="numeric"
              placeholder="7"
              value={draft.window.daysAhead}
              onChange={(e) => setWindow({ daysAhead: e.target.value })}
            />
          </div>
        </div>
        <label className="row" style={{ marginTop: "0.75rem" }}>
          <input
            type="checkbox"
            checked={draft.window.useHoursOfDay}
            onChange={(e) => setWindow({ useHoursOfDay: e.target.checked })}
          />
          Only certain hours of the day (local time)
        </label>
        {draft.window.useHoursOfDay && (
          <div className="window-grid" style={{ marginTop: "0.5rem" }}>
            <div className="field">
              <label htmlFor="hours-from">From hour (0–23)</label>
              <input
                id="hours-from"
                className="input"
                inputMode="numeric"
                value={draft.window.hoursFrom}
                onChange={(e) => setWindow({ hoursFrom: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="hours-to">To hour (0–23, inclusive)</label>
              <input
                id="hours-to"
                className="input"
                inputMode="numeric"
                value={draft.window.hoursTo}
                onChange={(e) => setWindow({ hoursTo: e.target.value })}
              />
            </div>
          </div>
        )}
      </section>

      {(errors.messages.length > 0 || serverError) && (
        <div className="notice error" role="alert">
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {errors.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
            {serverError && <li>{serverError}</li>}
          </ul>
        </div>
      )}
      <div className="row">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? <span className="spinner" /> : null} {saveLabel}
        </button>
      </div>
    </form>
  );
}

function GroupEditor({
  group,
  root,
  setRoot,
  errors,
  depth,
}: {
  group: GroupDraft;
  root: GroupDraft;
  setRoot: (root: GroupDraft) => void;
  errors: Record<string, string>;
  depth: number;
}) {
  const setOperator = (operator: "all" | "any") =>
    setRoot(updateNode(root, group.key, (n) => (n.kind === "group" ? { ...n, operator } : n)));
  return (
    <div className="group" data-testid="group" data-operator={group.operator}>
      <div className="group-head">
        <span className="muted small">Match</span>
        <span className="op">
          <button
            type="button"
            aria-pressed={group.operator === "all"}
            onClick={() => setOperator("all")}
          >
            all of
          </button>
          <button
            type="button"
            aria-pressed={group.operator === "any"}
            onClick={() => setOperator("any")}
          >
            any of
          </button>
        </span>
        <span className="muted small">these</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn sm"
          onClick={() => setRoot(addChild(root, group.key, newCondition()))}
        >
          + Condition
        </button>
        {depth < 4 && (
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              setRoot(addChild(root, group.key, newGroup(group.operator === "all" ? "any" : "all")))
            }
          >
            + Group
          </button>
        )}
        {depth > 0 && (
          <button
            type="button"
            className="btn sm danger"
            aria-label="Remove group"
            onClick={() => setRoot(removeNode(root, group.key))}
          >
            ✕
          </button>
        )}
      </div>
      {errors[group.key] && <p className="error small">{errors[group.key]}</p>}
      <div className="children">
        {group.children.map((child, i) => (
          <div key={child.key}>
            {i > 0 && (
              <div className="muted small" style={{ padding: "0 0 0.4rem 0.25rem" }}>
                {group.operator === "all" ? "and" : "or"}
              </div>
            )}
            {child.kind === "group" ? (
              <GroupEditor
                group={child}
                root={root}
                setRoot={setRoot}
                errors={errors}
                depth={depth + 1}
              />
            ) : (
              <ConditionEditor
                condition={child}
                root={root}
                setRoot={setRoot}
                error={errors[child.key]}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConditionEditor({
  condition,
  root,
  setRoot,
  error,
}: {
  condition: ConditionDraft;
  root: GroupDraft;
  setRoot: (root: GroupDraft) => void;
  error?: string;
}) {
  const patch = (p: Partial<ConditionDraft>) =>
    setRoot(updateNode(root, condition.key, (n) => (n.kind === "condition" ? { ...n, ...p } : n)));
  const variable = findVariable(condition.variable, condition.granularity);
  const onGranularity = (granularity: "hourly" | "daily") => {
    const first = variablesFor(granularity)[0];
    patch({
      granularity,
      variable: findVariable(condition.variable, granularity)?.name ?? first.name,
    });
  };
  const nodeId = `cond-${condition.key}`;
  return (
    <div data-testid="condition">
      <div className="condition">
        <select
          className="input"
          aria-label="Granularity"
          value={condition.granularity}
          onChange={(e) => onGranularity(e.target.value as "hourly" | "daily")}
        >
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
        </select>
        <select
          className="input variable"
          aria-label="Variable"
          id={`${nodeId}-variable`}
          value={condition.variable}
          onChange={(e) => patch({ variable: e.target.value })}
        >
          {variablesFor(condition.granularity).map((v) => (
            <option key={v.name} value={v.name}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Comparator"
          value={condition.comparator}
          onChange={(e) => patch({ comparator: e.target.value as ConditionDraft["comparator"] })}
        >
          {COMPARATORS.map((c) => (
            <option key={c} value={c}>
              {c} {COMPARATOR_LABELS[c]}
            </option>
          ))}
        </select>
        <input
          className="input"
          aria-label="Value"
          inputMode="decimal"
          value={condition.value}
          onChange={(e) => patch({ value: e.target.value })}
        />
        <span className="row" style={{ gap: "0.4rem" }}>
          <span className="unit">{variable?.unit ?? ""}</span>
          <select
            className="input"
            aria-label="Quantifier"
            style={{ width: "auto" }}
            value={condition.quantifier}
            onChange={(e) => patch({ quantifier: e.target.value as "any" | "all" })}
          >
            <option value="any">at any time</option>
            <option value="all">the whole time</option>
          </select>
          <button
            type="button"
            className="btn sm danger"
            aria-label="Remove condition"
            onClick={() => setRoot(removeNode(root, condition.key))}
          >
            ✕
          </button>
        </span>
      </div>
      {error && (
        <p className="error small" style={{ margin: "0.25rem 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export type { NodeDraft };
