import type { Place } from "@arena-weather/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "~/components/RequireAuth";
import { RuleBuilder } from "~/components/RuleBuilder";
import { api, errorMessage } from "~/lib/api";
import { emptyDraft } from "~/lib/rule-draft";

type Search = { lat?: number; lon?: number; name?: string; tz?: string };

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
};

export const Route = createFileRoute("/rules/new")({
  validateSearch: (raw: Record<string, unknown>): Search => ({
    lat: num(raw.lat),
    lon: num(raw.lon),
    name: typeof raw.name === "string" ? raw.name : undefined,
    tz: typeof raw.tz === "string" ? raw.tz : undefined,
  }),
  component: () => (
    <RequireAuth what="create a rule">
      <NewRulePage />
    </RequireAuth>
  ),
});

function NewRulePage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const place: Place | null =
    search.lat !== undefined && search.lon !== undefined
      ? {
          label: search.name ?? `${search.lat}, ${search.lon}`,
          latitude: search.lat,
          longitude: search.lon,
          ...(search.tz ? { timezone: search.tz } : {}),
        }
      : null;
  const create = useMutation({
    mutationFn: api.createRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      navigate({ to: "/rules" });
    },
  });
  return (
    <div className="stack">
      <h1>New rule</h1>
      <RuleBuilder
        initial={emptyDraft(place)}
        onSave={(d) => create.mutate(d)}
        saving={create.isPending}
        saveLabel="Create rule"
        serverError={create.isError ? errorMessage(create.error) : null}
      />
    </div>
  );
}
