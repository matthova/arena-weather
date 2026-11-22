import type { Rule, RuleTestResponse } from "@arena-weather/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { EvaluationTree } from "~/components/EvaluationTree";
import { RequireAuth } from "~/components/RequireAuth";
import { api, errorMessage } from "~/lib/api";
import { describeRule, describeWindow } from "~/lib/rule-draft";

export const Route = createFileRoute("/rules/")({
  component: () => (
    <RequireAuth what="manage your rules">
      <RulesPage />
    </RequireAuth>
  ),
});

function RulesPage() {
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api.listRules() });
  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Your rules</h1>
        <Link to="/rules/new" search={{}} className="btn primary">
          + New rule
        </Link>
      </div>
      {rules.isPending && (
        <p className="muted">
          <span className="spinner" /> Loading…
        </p>
      )}
      {rules.isError && <div className="notice error">{errorMessage(rules.error)}</div>}
      {rules.data && rules.data.rules.length === 0 && (
        <div className="card hero">
          <h2>No rules yet</h2>
          <p className="muted">
            A rule describes the weather you care about at a place, e.g. "rain chance ≥ 60 % and
            gusts above 50 km/h in the next 12 hours". You get one push notification when it becomes
            true.
          </p>
          <Link to="/rules/new" search={{}} className="btn primary">
            Create your first rule
          </Link>
        </div>
      )}
      {rules.data && rules.data.rules.length > 0 && (
        <div className="rule-list">
          {rules.data.rules.map((r) => (
            <RuleCard key={r.id} rule={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function RuleCard({ rule }: { rule: Rule }) {
  const qc = useQueryClient();
  const [testResult, setTestResult] = useState<RuleTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["rules"] });
  const onError = (e: unknown) => setError(errorMessage(e));
  const pause = useMutation({
    mutationFn: () => (rule.paused ? api.resumeRule(rule.id) : api.pauseRule(rule.id)),
    onMutate: () => setError(null),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteRule(rule.id),
    onMutate: () => setError(null),
    onSuccess: invalidate,
    onError,
  });
  const test = useMutation({
    mutationFn: () => api.testRule(rule.id),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setTestResult(r);
      invalidate();
    },
    onError,
  });
  const busy = pause.isPending || remove.isPending || test.isPending;

  return (
    <article className="card rule-card" data-testid="rule-card">
      <div className="row between">
        <h3>{rule.name}</h3>
        <span className="row">
          {rule.paused ? (
            <span className="badge warn">Paused</span>
          ) : rule.armed ? (
            <span className="badge ok">Armed</span>
          ) : (
            <span className="badge">Fired, waiting to re-arm</span>
          )}
        </span>
      </div>
      <div className="muted small">
        {rule.place.label} · {describeWindow(rule.window)}
      </div>
      <p className="summary">{describeRule(rule.root)}</p>
      {rule.lastFiredAt && (
        <div className="muted small">Last fired {new Date(rule.lastFiredAt).toLocaleString()}</div>
      )}
      <div className="actions" style={{ marginTop: "0.5rem" }}>
        <button
          type="button"
          className="btn sm primary"
          disabled={busy}
          onClick={() => test.mutate()}
          data-testid="test-rule"
        >
          {test.isPending ? <span className="spinner" /> : null} Test this rule now
        </button>
        <Link to="/rules/$ruleId" params={{ ruleId: rule.id }} className="btn sm">
          Edit
        </Link>
        <button type="button" className="btn sm" disabled={busy} onClick={() => pause.mutate()}>
          {rule.paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="btn sm danger"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete "${rule.name}"?`)) remove.mutate();
          }}
        >
          Delete
        </button>
      </div>
      {error && (
        <p className="error small" style={{ marginTop: "0.5rem" }}>
          {error}
        </p>
      )}
      {testResult && (
        <div style={{ marginTop: "0.75rem" }}>
          <EvaluationTree result={testResult} timeZone={rule.place.timezone ?? "UTC"} />
          {testResult.push.attempted === 0 && (
            <p className="small muted" style={{ marginTop: "0.4rem" }}>
              Turn on <Link to="/notifications">notifications</Link> on this device to receive the
              push.
            </p>
          )}
        </div>
      )}
    </article>
  );
}
