import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "~/components/RequireAuth";
import { RuleBuilder } from "~/components/RuleBuilder";
import { api, errorMessage } from "~/lib/api";
import { draftFromDefinition } from "~/lib/rule-draft";

export const Route = createFileRoute("/rules/$ruleId")({
  component: () => (
    <RequireAuth what="edit a rule">
      <EditRulePage />
    </RequireAuth>
  ),
});

function EditRulePage() {
  const { ruleId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const rule = useQuery({ queryKey: ["rules", ruleId], queryFn: () => api.getRule(ruleId) });
  const update = useMutation({
    mutationFn: (d: Parameters<typeof api.updateRule>[1]) => api.updateRule(ruleId, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      navigate({ to: "/rules" });
    },
  });
  if (rule.isPending)
    return (
      <p className="muted">
        <span className="spinner" /> Loading rule…
      </p>
    );
  if (rule.isError) return <div className="notice error">{errorMessage(rule.error)}</div>;
  return (
    <div className="stack">
      <h1>Edit rule</h1>
      <RuleBuilder
        initial={draftFromDefinition(rule.data.rule)}
        onSave={(d) => update.mutate(d)}
        saving={update.isPending}
        serverError={update.isError ? errorMessage(update.error) : null}
      />
    </div>
  );
}
