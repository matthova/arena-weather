import { describeCondition, type NodeResult, type RuleTestResponse } from "@arena-weather/core";
import { formatDateTime } from "~/lib/format";

function Node({ node, timeZone }: { node: NodeResult; timeZone: string }) {
  if (node.type === "condition")
    return (
      <li data-holds={node.holds}>
        {describeCondition(node)}
        <span className="muted">
          {node.missingVariable
            ? " · variable missing from the forecast"
            : ` · ${node.matchCount}/${node.sampleCount} samples${node.firstMatch ? `, first ${formatDateTime(node.firstMatch.time, timeZone)}` : ""}`}
        </span>
      </li>
    );
  return (
    <li data-holds={node.holds}>
      {node.operator === "all" ? "all of" : "any of"}
      <ul className="eval-tree">
        {node.children.map((c, i) => (
          <Node key={c.id ?? i} node={c} timeZone={timeZone} />
        ))}
      </ul>
    </li>
  );
}

/** Result of "Test this rule now": whether it matched, why, and how the push went. */
export function EvaluationTree({
  result,
  timeZone,
}: {
  result: RuleTestResponse;
  timeZone: string;
}) {
  const { evaluation, push } = result;
  return (
    <div className={`notice small ${evaluation.matched ? "ok" : ""}`} data-testid="test-result">
      <div className="row between">
        <strong>
          {evaluation.matched ? "Conditions are met right now" : "Conditions are not met right now"}
        </strong>
        <span className="muted">
          push: {push.delivered}/{push.attempted} delivered
          {push.attempted === 0 ? " (no devices registered)" : ""}
        </span>
      </div>
      <div className="muted">{result.message}</div>
      <ul className="eval-tree" style={{ paddingLeft: 0 }}>
        <Node node={evaluation.root} timeZone={timeZone} />
      </ul>
    </div>
  );
}
