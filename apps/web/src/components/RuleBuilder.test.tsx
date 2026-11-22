import type { RuleDefinition } from "@arena-weather/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyDraft } from "~/lib/rule-draft";
import { RuleBuilder } from "./RuleBuilder";

const berlin = { label: "Berlin", latitude: 52.52, longitude: 13.41, timezone: "Europe/Berlin" };

function renderBuilder(onSave: (d: RuleDefinition) => void) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <RuleBuilder initial={emptyDraft(berlin)} onSave={onSave} />
    </QueryClientProvider>,
  );
}

describe("<RuleBuilder>", () => {
  it("builds a nested all/any rule and saves it as core JSON", () => {
    const onSave = vi.fn();
    renderBuilder(onSave);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Storm watch" } });

    // root group: default condition precipitation_probability >= 60; add a nested group
    const root = screen.getAllByTestId("group")[0];
    if (!root) throw new Error("no root group");
    fireEvent.click(within(root).getByText("+ Group"));
    const groups = screen.getAllByTestId("group");
    expect(groups).toHaveLength(2);
    const nested = groups[1];
    if (!nested) throw new Error("no nested group");
    expect(nested.dataset.operator).toBe("any");

    // nested group: configure its default condition and add a daily one
    fireEvent.click(within(nested).getByText("+ Condition"));
    const conds = within(nested).getAllByTestId("condition");
    expect(conds).toHaveLength(2);
    const [first, second] = conds;
    if (!first || !second) throw new Error("conditions missing");
    fireEvent.change(within(first).getByLabelText("Variable"), { target: { value: "wind_gusts_10m" } });
    fireEvent.change(within(first).getByLabelText("Comparator"), { target: { value: ">" } });
    fireEvent.change(within(first).getByLabelText("Value"), { target: { value: "50" } });
    fireEvent.change(within(second).getByLabelText("Granularity"), { target: { value: "daily" } });
    fireEvent.change(within(second).getByLabelText("Variable"), { target: { value: "weather_code" } });
    fireEvent.change(within(second).getByLabelText("Comparator"), { target: { value: "==" } });
    fireEvent.change(within(second).getByLabelText("Value"), { target: { value: "95" } });

    fireEvent.change(screen.getByLabelText("Hours ahead (1–168)"), { target: { value: "12" } });

    fireEvent.click(screen.getByText("Save rule"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      name: "Storm watch",
      place: berlin,
      window: { hoursAhead: 12 },
      root: {
        type: "group",
        operator: "all",
        children: [
          { type: "condition", granularity: "hourly", variable: "precipitation_probability", comparator: ">=", value: 60, quantifier: "any" },
          {
            type: "group",
            operator: "any",
            children: [
              { type: "condition", granularity: "hourly", variable: "wind_gusts_10m", comparator: ">", value: 50, quantifier: "any" },
              { type: "condition", granularity: "daily", variable: "weather_code", comparator: "==", value: 95, quantifier: "any" },
            ],
          },
        ],
      },
    });
  });

  it("switches the root operator and blocks saving without a name", () => {
    const onSave = vi.fn();
    renderBuilder(onSave);
    fireEvent.click(screen.getByText("any of"));
    expect(screen.getAllByTestId("group")[0]?.dataset.operator).toBe("any");
    fireEvent.click(screen.getByText("Save rule"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Give the rule a name");
  });
});
