import Foundation
import Observation

/**
 The rule builder's editable state (the Swift twin of `apps/web/src/lib/rule-draft.ts`). It mirrors the
 rule JSON but keeps numeric fields as text while typing and gives every node a stable identity, which
 SwiftUI needs for `ForEach` and bindings. Reference types so nested editors mutate in place.
 `RuleDraft.definition()` is the only way out: it validates with the same rules as core's zod schema
 (the server validates again) and produces the shared JSON.
 */
@Observable
public final class ConditionDraft: Identifiable {
    public let id: UUID
    public var granularity: Granularity
    public var variable: String
    public var comparator: Comparator
    public var value: String
    public var quantifier: Quantifier

    public init(id: UUID = UUID(), granularity: Granularity = .hourly, variable: String = "precipitation_probability",
                comparator: Comparator = .greaterOrEqual, value: String = "60", quantifier: Quantifier = .any) {
        self.id = id
        self.granularity = granularity
        self.variable = variable
        self.comparator = comparator
        self.value = value
        self.quantifier = quantifier
    }

    public convenience init(_ condition: Condition) {
        self.init(granularity: condition.granularity, variable: condition.variable, comparator: condition.comparator,
                  value: Describe.number(condition.value), quantifier: condition.quantifier ?? .any)
    }

    public var weatherVariable: WeatherVariable? { Variables.find(variable, granularity) }

    /// Switching hourly ↔ daily: keep the variable when it exists in both lists, else pick the first.
    public func setGranularity(_ g: Granularity) {
        granularity = g
        if Variables.find(variable, g) == nil { variable = Variables.list(for: g).first?.name ?? "" }
    }
}

@Observable
public final class GroupDraft: Identifiable {
    public let id: UUID
    public var op: GroupOperator
    public var children: [NodeDraft]

    public init(id: UUID = UUID(), op: GroupOperator = .all, children: [NodeDraft]? = nil) {
        self.id = id
        self.op = op
        self.children = children ?? [.condition(ConditionDraft())]
    }

    public convenience init(_ group: ConditionGroup) {
        self.init(op: group.op, children: group.children.map(NodeDraft.init))
    }

    public func addCondition() { children.append(.condition(ConditionDraft())) }
    public func addGroup(_ op: GroupOperator = .any) { children.append(.group(GroupDraft(op: op))) }
    public func remove(id: UUID) { children.removeAll { $0.id == id } }

    /// 1 for a flat group (core's `groupDepth`).
    public var depth: Int { 1 + (children.map(\.depth).max() ?? 0) }
    public var conditionCount: Int { children.reduce(0) { $0 + $1.conditionCount } }
}

public enum NodeDraft: Identifiable {
    case condition(ConditionDraft)
    case group(GroupDraft)

    public init(_ node: RuleNode) {
        switch node {
        case .condition(let c): self = .condition(ConditionDraft(c))
        case .group(let g): self = .group(GroupDraft(g))
        }
    }

    public var id: UUID {
        switch self {
        case .condition(let c): return c.id
        case .group(let g): return g.id
        }
    }

    var depth: Int {
        switch self {
        case .condition: return 0
        case .group(let g): return g.depth
        }
    }

    var conditionCount: Int {
        switch self {
        case .condition: return 1
        case .group(let g): return g.conditionCount
        }
    }
}

public struct DraftErrors: Error, Equatable, Sendable {
    /// Form-level messages (name, place, window).
    public var messages: [String] = []
    /// Per node id.
    public var nodes: [UUID: String] = [:]

    public var isEmpty: Bool { messages.isEmpty && nodes.isEmpty }

    public var summary: String {
        var all = messages
        if !nodes.isEmpty { all.append(nodes.count == 1 ? "1 condition needs attention" : "\(nodes.count) conditions need attention") }
        return all.joined(separator: "\n")
    }
}

@Observable
public final class RuleDraft {
    public var name: String
    public var place: Place?
    public var hoursAhead: String
    public var daysAhead: String
    public var useHoursOfDay: Bool
    public var hoursFrom: Int
    public var hoursTo: Int
    public var root: GroupDraft

    public init(name: String = "", place: Place? = nil, hoursAhead: String = "", daysAhead: String = "",
                useHoursOfDay: Bool = false, hoursFrom: Int = 8, hoursTo: Int = 20, root: GroupDraft = GroupDraft()) {
        self.name = name
        self.place = place
        self.hoursAhead = hoursAhead
        self.daysAhead = daysAhead
        self.useHoursOfDay = useHoursOfDay
        self.hoursFrom = hoursFrom
        self.hoursTo = hoursTo
        self.root = root
    }

    /// Editing an existing rule.
    public convenience init(_ definition: RuleDefinition) {
        let w = definition.window
        self.init(
            name: definition.name,
            place: definition.place,
            hoursAhead: w?.hoursAhead.map(String.init) ?? "",
            daysAhead: w?.daysAhead.map(String.init) ?? "",
            useHoursOfDay: w?.hoursOfDay != nil,
            hoursFrom: w?.hoursOfDay?.from ?? 8,
            hoursTo: w?.hoursOfDay?.to ?? 20,
            root: GroupDraft(definition.root)
        )
    }

    // MARK: Draft → rule JSON

    /// "60", " 60 ", "0,5" → number; "" or "abc" → nil.
    public static func parseNumber(_ text: String) -> Double? {
        let t = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard !t.isEmpty, let n = Double(t), n.isFinite else { return nil }
        return n
    }

    private static func parseInt(_ text: String, in range: ClosedRange<Int>, _ what: String, _ errors: inout DraftErrors) -> Int? {
        let t = text.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return nil }
        guard let n = parseNumber(t), n == n.rounded(), range.contains(Int(n)) else {
            errors.messages.append("\(what) must be a whole number from \(range.lowerBound) to \(range.upperBound)")
            return nil
        }
        return Int(n)
    }

    private static func node(_ draft: NodeDraft, depth: Int, errors: inout DraftErrors) -> RuleNode {
        switch draft {
        case .group(let g):
            if g.children.isEmpty { errors.nodes[g.id] = "Add at least one condition to this group" }
            if g.children.count > RuleLimits.maxGroupChildren { errors.nodes[g.id] = "At most \(RuleLimits.maxGroupChildren) items in a group" }
            if depth > RuleLimits.maxGroupDepth { errors.nodes[g.id] = "Groups may be nested at most \(RuleLimits.maxGroupDepth) levels deep" }
            return .group(ConditionGroup(op: g.op, children: g.children.map { node($0, depth: depth + 1, errors: &errors) }))
        case .condition(let c):
            let value = parseNumber(c.value)
            if value == nil { errors.nodes[c.id] = "Enter a number" }
            if Variables.find(c.variable, c.granularity) == nil { errors.nodes[c.id] = "Pick a variable" }
            return .condition(Condition(granularity: c.granularity, variable: c.variable, comparator: c.comparator,
                                        value: value ?? .nan, quantifier: c.quantifier == .any ? nil : c.quantifier))
        }
    }

    /// Serialises to the shared rule JSON, or returns what to fix.
    public func definition() -> Result<RuleDefinition, DraftErrors> {
        var errors = DraftErrors()
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty { errors.messages.append("Give the rule a name") }
        if trimmedName.count > RuleLimits.maxNameLength { errors.messages.append("The name is too long (max \(RuleLimits.maxNameLength) characters)") }
        if place == nil { errors.messages.append("Pick a place") }

        var window = TimeWindow()
        window.hoursAhead = Self.parseInt(hoursAhead, in: RuleLimits.hoursAhead, "Hours ahead", &errors)
        window.daysAhead = Self.parseInt(daysAhead, in: RuleLimits.daysAhead, "Days ahead", &errors)
        if useHoursOfDay {
            if RuleLimits.hourOfDay.contains(hoursFrom), RuleLimits.hourOfDay.contains(hoursTo) {
                window.hoursOfDay = HoursOfDay(from: hoursFrom, to: hoursTo)
            } else {
                errors.messages.append("Hours of day must be 0–23")
            }
        }

        let rootNode = Self.node(.group(root), depth: 1, errors: &errors)
        guard errors.isEmpty, let place, case .group(let rootGroup) = rootNode else { return .failure(errors) }
        return .success(RuleDefinition(name: trimmedName, place: place, window: window.isEmpty ? nil : window, root: rootGroup))
    }
}
