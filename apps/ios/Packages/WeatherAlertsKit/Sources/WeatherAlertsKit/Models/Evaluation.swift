import Foundation

// `RuleEvaluation` as `POST /api/rules/:id/test` returns it (packages/core/src/evaluate.ts).

public struct Sample: Codable, Hashable, Sendable {
    public var time: Int
    public var value: Double

    public init(time: Int, value: Double) {
        self.time = time
        self.value = value
    }
}

public struct ConditionResult: Codable, Hashable, Sendable {
    public var id: String?
    public var granularity: Granularity
    public var variable: String
    public var comparator: Comparator
    public var value: Double
    public var quantifier: Quantifier
    public var holds: Bool
    public var sampleCount: Int
    public var matchCount: Int
    public var firstMatch: Sample?
    public var missingVariable: Bool?

    enum CodingKeys: String, CodingKey {
        case type, id, granularity, variable, comparator, value, quantifier, holds, sampleCount, matchCount, firstMatch, missingVariable
    }

    public init(id: String? = nil, granularity: Granularity, variable: String, comparator: Comparator, value: Double,
                quantifier: Quantifier = .any, holds: Bool, sampleCount: Int, matchCount: Int, firstMatch: Sample? = nil,
                missingVariable: Bool? = nil) {
        self.id = id
        self.granularity = granularity
        self.variable = variable
        self.comparator = comparator
        self.value = value
        self.quantifier = quantifier
        self.holds = holds
        self.sampleCount = sampleCount
        self.matchCount = matchCount
        self.firstMatch = firstMatch
        self.missingVariable = missingVariable
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id)
        granularity = try c.decode(Granularity.self, forKey: .granularity)
        variable = try c.decode(String.self, forKey: .variable)
        comparator = try c.decode(Comparator.self, forKey: .comparator)
        value = try c.decode(Double.self, forKey: .value)
        quantifier = try c.decodeIfPresent(Quantifier.self, forKey: .quantifier) ?? .any
        holds = try c.decode(Bool.self, forKey: .holds)
        sampleCount = try c.decode(Int.self, forKey: .sampleCount)
        matchCount = try c.decode(Int.self, forKey: .matchCount)
        firstMatch = try c.decodeIfPresent(Sample.self, forKey: .firstMatch)
        missingVariable = try c.decodeIfPresent(Bool.self, forKey: .missingVariable)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("condition", forKey: .type)
        try c.encodeIfPresent(id, forKey: .id)
        try c.encode(granularity, forKey: .granularity)
        try c.encode(variable, forKey: .variable)
        try c.encode(comparator, forKey: .comparator)
        try c.encode(value, forKey: .value)
        try c.encode(quantifier, forKey: .quantifier)
        try c.encode(holds, forKey: .holds)
        try c.encode(sampleCount, forKey: .sampleCount)
        try c.encode(matchCount, forKey: .matchCount)
        try c.encodeIfPresent(firstMatch, forKey: .firstMatch)
        try c.encodeIfPresent(missingVariable, forKey: .missingVariable)
    }
}

public struct GroupResult: Codable, Hashable, Sendable {
    public var id: String?
    public var op: GroupOperator
    public var holds: Bool
    public var children: [NodeResult]

    enum CodingKeys: String, CodingKey { case type, id, op = "operator", holds, children }

    public init(id: String? = nil, op: GroupOperator, holds: Bool, children: [NodeResult]) {
        self.id = id
        self.op = op
        self.holds = holds
        self.children = children
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id)
        op = try c.decode(GroupOperator.self, forKey: .op)
        holds = try c.decode(Bool.self, forKey: .holds)
        children = try c.decode([NodeResult].self, forKey: .children)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode("group", forKey: .type)
        try c.encodeIfPresent(id, forKey: .id)
        try c.encode(op, forKey: .op)
        try c.encode(holds, forKey: .holds)
        try c.encode(children, forKey: .children)
    }
}

public indirect enum NodeResult: Codable, Hashable, Sendable {
    case condition(ConditionResult)
    case group(GroupResult)

    private enum TypeKey: String, CodingKey { case type }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: TypeKey.self)
        switch try c.decode(String.self, forKey: .type) {
        case "condition": self = .condition(try ConditionResult(from: decoder))
        case "group": self = .group(try GroupResult(from: decoder))
        case let other:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown result type \(other)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .condition(let r): try r.encode(to: encoder)
        case .group(let g): try g.encode(to: encoder)
        }
    }

    public var holds: Bool {
        switch self {
        case .condition(let r): return r.holds
        case .group(let g): return g.holds
        }
    }
}

public struct RuleEvaluation: Codable, Hashable, Sendable {
    public var matched: Bool
    public var evaluatedAt: Int
    public var root: GroupResult

    public init(matched: Bool, evaluatedAt: Int, root: GroupResult) {
        self.matched = matched
        self.evaluatedAt = evaluatedAt
        self.root = root
    }
}
