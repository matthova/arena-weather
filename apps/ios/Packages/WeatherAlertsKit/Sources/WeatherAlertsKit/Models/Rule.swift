import Foundation

// The shared rule JSON (packages/core/src/rule.ts). Field names and shapes are identical on the wire.

public enum Comparator: String, Codable, CaseIterable, Hashable, Sendable {
    case lessThan = "<"
    case lessOrEqual = "<="
    case greaterThan = ">"
    case greaterOrEqual = ">="
    case equal = "=="
    case notEqual = "!="

    public var label: String {
        switch self {
        case .lessThan: return "below"
        case .lessOrEqual: return "at most"
        case .greaterThan: return "above"
        case .greaterOrEqual: return "at least"
        case .equal: return "equal to"
        case .notEqual: return "not equal to"
        }
    }
}

public enum GroupOperator: String, Codable, CaseIterable, Hashable, Sendable {
    /// Every child must hold (AND).
    case all
    /// At least one child must hold (OR).
    case any

    public var label: String {
        switch self {
        case .all: return "All of"
        case .any: return "Any of"
        }
    }
}

public enum Quantifier: String, Codable, CaseIterable, Hashable, Sendable {
    /// At least one forecast sample in the window satisfies the condition (default).
    case any
    /// Every sample in the window does.
    case all

    public var label: String {
        switch self {
        case .any: return "at some point"
        case .all: return "the whole time"
        }
    }
}

public struct Place: Codable, Hashable, Sendable {
    public var label: String
    public var latitude: Double
    public var longitude: Double
    /// IANA timezone, e.g. "Europe/Berlin". Optional: the server resolves it.
    public var timezone: String?

    public init(label: String, latitude: Double, longitude: Double, timezone: String? = nil) {
        self.label = label
        self.latitude = latitude
        self.longitude = longitude
        self.timezone = timezone
    }
}

public struct HoursOfDay: Codable, Hashable, Sendable {
    public var from: Int
    public var to: Int

    public init(from: Int, to: Int) {
        self.from = from
        self.to = to
    }
}

public struct TimeWindow: Codable, Hashable, Sendable {
    /// 1...168, default 24.
    public var hoursAhead: Int?
    /// 1...7, today = 1, default 7.
    public var daysAhead: Int?
    /// Local hours of day, inclusive; `from > to` wraps midnight.
    public var hoursOfDay: HoursOfDay?

    public init(hoursAhead: Int? = nil, daysAhead: Int? = nil, hoursOfDay: HoursOfDay? = nil) {
        self.hoursAhead = hoursAhead
        self.daysAhead = daysAhead
        self.hoursOfDay = hoursOfDay
    }

    public var isEmpty: Bool { hoursAhead == nil && daysAhead == nil && hoursOfDay == nil }
}

public struct Condition: Codable, Hashable, Sendable {
    public var id: String?
    public var granularity: Granularity
    public var variable: String
    public var comparator: Comparator
    public var value: Double
    /// Omitted on the wire means "any".
    public var quantifier: Quantifier?

    public init(id: String? = nil, granularity: Granularity, variable: String, comparator: Comparator,
                value: Double, quantifier: Quantifier? = nil) {
        self.id = id
        self.granularity = granularity
        self.variable = variable
        self.comparator = comparator
        self.value = value
        self.quantifier = quantifier
    }

    enum CodingKeys: String, CodingKey { case type, id, granularity, variable, comparator, value, quantifier }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        guard type == "condition" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "expected type=condition")
        }
        id = try c.decodeIfPresent(String.self, forKey: .id)
        granularity = try c.decode(Granularity.self, forKey: .granularity)
        variable = try c.decode(String.self, forKey: .variable)
        comparator = try c.decode(Comparator.self, forKey: .comparator)
        value = try c.decode(Double.self, forKey: .value)
        quantifier = try c.decodeIfPresent(Quantifier.self, forKey: .quantifier)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("condition", forKey: .type)
        try c.encodeIfPresent(id, forKey: .id)
        try c.encode(granularity, forKey: .granularity)
        try c.encode(variable, forKey: .variable)
        try c.encode(comparator, forKey: .comparator)
        try c.encode(value, forKey: .value)
        try c.encodeIfPresent(quantifier, forKey: .quantifier)
    }

    public var weatherVariable: WeatherVariable? { Variables.find(variable, granularity) }
}

public struct ConditionGroup: Codable, Hashable, Sendable {
    public var id: String?
    /// `operator` on the wire (a Swift keyword, hence the name).
    public var op: GroupOperator
    public var children: [RuleNode]

    public init(id: String? = nil, op: GroupOperator, children: [RuleNode]) {
        self.id = id
        self.op = op
        self.children = children
    }

    enum CodingKeys: String, CodingKey { case type, id, op = "operator", children }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        guard type == "group" else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "expected type=group")
        }
        id = try c.decodeIfPresent(String.self, forKey: .id)
        op = try c.decode(GroupOperator.self, forKey: .op)
        children = try c.decode([RuleNode].self, forKey: .children)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("group", forKey: .type)
        try c.encodeIfPresent(id, forKey: .id)
        try c.encode(op, forKey: .op)
        try c.encode(children, forKey: .children)
    }
}

public indirect enum RuleNode: Codable, Hashable, Sendable {
    case condition(Condition)
    case group(ConditionGroup)

    private enum TypeKey: String, CodingKey { case type }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: TypeKey.self)
        switch try c.decode(String.self, forKey: .type) {
        case "condition": self = .condition(try Condition(from: decoder))
        case "group": self = .group(try ConditionGroup(from: decoder))
        case let other:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown node type \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .condition(let condition): try condition.encode(to: encoder)
        case .group(let group): try group.encode(to: encoder)
        }
    }

    /// Every condition in the subtree, depth first.
    public var conditions: [Condition] {
        switch self {
        case .condition(let c): return [c]
        case .group(let g): return g.children.flatMap(\.conditions)
        }
    }

    /// 0 for a condition, 1 + deepest child for a group (`groupDepth` in core).
    public var groupDepth: Int {
        switch self {
        case .condition: return 0
        case .group(let g): return 1 + (g.children.map(\.groupDepth).max() ?? 0)
        }
    }
}

public enum RuleLimits {
    public static let maxGroupDepth = 5
    public static let maxGroupChildren = 20
    public static let maxNameLength = 120
    public static let hoursAhead = 1...168
    public static let daysAhead = 1...7
    public static let hourOfDay = 0...23
}

/// What a user authors: the body of `POST/PUT /api/rules`.
public struct RuleDefinition: Codable, Hashable, Sendable {
    public var name: String
    public var place: Place
    public var window: TimeWindow?
    public var root: ConditionGroup

    public init(name: String, place: Place, window: TimeWindow? = nil, root: ConditionGroup) {
        self.name = name
        self.place = place
        self.window = window
        self.root = root
    }
}

/// A stored rule as the API returns it (definition + server bookkeeping).
public struct Rule: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var place: Place
    public var window: TimeWindow?
    public var root: ConditionGroup
    /// Paused rules are kept but never evaluated by the checker.
    public var paused: Bool
    /// `true` = fires the next time it becomes true.
    public var armed: Bool
    public var lastEvaluatedAt: String?
    public var lastFiredAt: String?
    public var createdAt: String
    public var updatedAt: String

    public init(id: String, name: String, place: Place, window: TimeWindow? = nil, root: ConditionGroup,
                paused: Bool = false, armed: Bool = true, lastEvaluatedAt: String? = nil, lastFiredAt: String? = nil,
                createdAt: String = "", updatedAt: String = "") {
        self.id = id
        self.name = name
        self.place = place
        self.window = window
        self.root = root
        self.paused = paused
        self.armed = armed
        self.lastEvaluatedAt = lastEvaluatedAt
        self.lastFiredAt = lastFiredAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var definition: RuleDefinition {
        RuleDefinition(name: name, place: place, window: window, root: root)
    }
}

public enum RuleJSON {
    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return e
    }

    public static func decoder() -> JSONDecoder { JSONDecoder() }
}
