import SwiftUI
import WeatherAlertsKit

/// The server's evaluation of a rule, node by node (same tree as the web's EvaluationTree).
struct EvaluationTreeView: View {
    let evaluation: RuleEvaluation
    let timeZone: TimeZone

    var body: some View {
        EvaluationNodeView(node: .group(evaluation.root), timeZone: timeZone)
    }
}

/// One node; nests itself for groups (a struct, so the recursion has a nominal type).
struct EvaluationNodeView: View {
    let node: NodeResult
    let timeZone: TimeZone

    var body: some View {
        switch node {
        case .group(let g):
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    HoldsMark(holds: g.holds)
                    Text(g.op == .all ? "All of" : "Any of").font(.subheadline.weight(.semibold))
                }
                ForEach(Array(g.children.enumerated()), id: \.offset) { _, child in
                    EvaluationNodeView(node: child, timeZone: timeZone)
                }
                .padding(.leading, 18)
            }
        case .condition(let c):
            HStack(alignment: .top, spacing: 6) {
                HoldsMark(holds: c.holds)
                VStack(alignment: .leading, spacing: 2) {
                    Text(Describe.condition(c)).font(.subheadline)
                    Text(detail(c)).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func detail(_ c: ConditionResult) -> String {
        if c.missingVariable == true { return "Variable missing from the forecast" }
        var text = "\(c.matchCount) of \(c.sampleCount) \(c.granularity == .hourly ? "hours" : "days") match"
        if c.quantifier == .all { text += " (needs all)" }
        if let first = c.firstMatch {
            text += " · first \(WeatherFormat.dateTime(first.time, timeZone: timeZone)) (\(Describe.number(first.value)))"
        }
        return text
    }
}

struct HoldsMark: View {
    let holds: Bool

    var body: some View {
        Image(systemName: holds ? "checkmark.circle.fill" : "xmark.circle")
            .foregroundStyle(holds ? Color.green : Color.secondary)
            .accessibilityLabel(holds ? "holds" : "does not hold")
    }
}
