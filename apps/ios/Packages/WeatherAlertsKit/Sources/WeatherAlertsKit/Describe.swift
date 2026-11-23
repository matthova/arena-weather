import Foundation

/// Human wording shared with the server (`describeCondition` / `describeEvaluation` in core), so the
/// app explains a rule the same way the notification does.
public enum Describe {
    /// "60" for 60.0, "0.5" for 0.5 (what JavaScript prints for the number).
    public static func number(_ value: Double) -> String {
        if value.isFinite, value == value.rounded(), abs(value) < 1e15 { return String(Int(value)) }
        var s = String(value)
        if s.hasSuffix(".0") { s.removeLast(2) }
        return s
    }

    public static func condition(variable: String, granularity: Granularity, comparator: Comparator, value: Double) -> String {
        let v = Variables.find(variable, granularity)
        let label = v?.label ?? variable
        let unit = v.map { $0.showsUnit ? " \($0.unit)" : "" } ?? ""
        return "\(label) \(comparator.rawValue) \(number(value))\(unit)"
    }

    public static func condition(_ c: Condition) -> String {
        condition(variable: c.variable, granularity: c.granularity, comparator: c.comparator, value: c.value)
    }

    public static func condition(_ r: ConditionResult) -> String {
        condition(variable: r.variable, granularity: r.granularity, comparator: r.comparator, value: r.value)
    }

    /// Short text for a notification: the conditions that currently hold.
    public static func evaluation(_ definition: RuleDefinition, _ evaluation: RuleEvaluation) -> String {
        var holding: [String] = []
        func walk(_ node: NodeResult) {
            switch node {
            case .condition(let r): if r.holds { holding.append(condition(r)) }
            case .group(let g): g.children.forEach(walk)
            }
        }
        walk(.group(evaluation.root))
        let whereText = definition.place.label
        if holding.isEmpty { return "\(definition.name) — conditions not met in \(whereText)" }
        return "\(holding.joined(separator: "; ")) in \(whereText)"
    }

    /// One line summarising a rule, e.g. "Precipitation chance >= 60 % and Wind gusts (10 m) > 50 km/h".
    public static func summary(_ group: ConditionGroup) -> String {
        let joiner = group.op == .all ? " and " : " or "
        return group.children.map { node -> String in
            switch node {
            case .condition(let c): return condition(c)
            case .group(let g): return "(" + summary(g) + ")"
            }
        }.joined(separator: joiner)
    }

    public static func window(_ window: TimeWindow?) -> String {
        guard let w = window, !w.isEmpty else { return "Next 24 hours / 7 days" }
        var parts: [String] = []
        if let h = w.hoursAhead { parts.append("next \(h) h") }
        if let d = w.daysAhead { parts.append(d == 1 ? "today" : "next \(d) days") }
        if let hod = w.hoursOfDay { parts.append(String(format: "%02d:00–%02d:59", hod.from, hod.to)) }
        return parts.joined(separator: ", ")
    }
}
