import XCTest
@testable import WeatherAlertsKit

/// The README's example rule must round-trip through the Swift models byte-for-byte in meaning.
final class RuleCodableTests: XCTestCase {
    static let readmeRule = """
    {
      "name": "Wet and windy evening",
      "place": { "label": "Berlin", "latitude": 52.52, "longitude": 13.41, "timezone": "Europe/Berlin" },
      "window": { "hoursAhead": 12, "hoursOfDay": { "from": 17, "to": 22 } },
      "root": {
        "type": "group", "operator": "all",
        "children": [
          { "type": "condition", "granularity": "hourly", "variable": "precipitation_probability", "comparator": ">=", "value": 60 },
          { "type": "group", "operator": "any", "children": [
            { "type": "condition", "granularity": "hourly", "variable": "wind_gusts_10m", "comparator": ">", "value": 50 },
            { "type": "condition", "granularity": "daily", "variable": "weather_code", "comparator": "==", "value": 95, "quantifier": "all" }
          ]}
        ]
      }
    }
    """

    func testDecodesTheReadmeRule() throws {
        let def = try RuleJSON.decoder().decode(RuleDefinition.self, from: Data(Self.readmeRule.utf8))
        XCTAssertEqual(def.name, "Wet and windy evening")
        XCTAssertEqual(def.place.timezone, "Europe/Berlin")
        XCTAssertEqual(def.window?.hoursAhead, 12)
        XCTAssertEqual(def.window?.hoursOfDay, HoursOfDay(from: 17, to: 22))
        XCTAssertNil(def.window?.daysAhead)
        XCTAssertEqual(def.root.op, .all)
        XCTAssertEqual(def.root.children.count, 2)
        guard case .condition(let first) = def.root.children[0] else { return XCTFail("first child is a condition") }
        XCTAssertEqual(first.variable, "precipitation_probability")
        XCTAssertEqual(first.comparator, .greaterOrEqual)
        XCTAssertEqual(first.value, 60)
        XCTAssertNil(first.quantifier)
        guard case .group(let nested) = def.root.children[1] else { return XCTFail("second child is a group") }
        XCTAssertEqual(nested.op, .any)
        guard case .condition(let last) = nested.children[1] else { return XCTFail("nested condition") }
        XCTAssertEqual(last.granularity, .daily)
        XCTAssertEqual(last.quantifier, .all)
        XCTAssertEqual(RuleNode.group(def.root).groupDepth, 2)
        XCTAssertEqual(RuleNode.group(def.root).conditions.count, 3)
    }

    func testEncodesTheSameJSONShape() throws {
        let def = try RuleJSON.decoder().decode(RuleDefinition.self, from: Data(Self.readmeRule.utf8))
        let data = try RuleJSON.encoder().encode(def)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let root = object?["root"] as? [String: Any]
        XCTAssertEqual(root?["type"] as? String, "group")
        XCTAssertEqual(root?["operator"] as? String, "all")
        let children = root?["children"] as? [[String: Any]]
        XCTAssertEqual(children?[0]["type"] as? String, "condition")
        XCTAssertEqual(children?[0]["comparator"] as? String, ">=")
        XCTAssertEqual(children?[0]["value"] as? Double, 60)
        XCTAssertNil(children?[0]["quantifier"], "an absent quantifier stays absent")
        XCTAssertNil(children?[0]["id"])
        let window = object?["window"] as? [String: Any]
        XCTAssertNil(window?["daysAhead"])
        // and it round-trips
        XCTAssertEqual(try RuleJSON.decoder().decode(RuleDefinition.self, from: data), def)
    }

    func testRejectsUnknownNodeTypes() {
        let bad = Data(#"{"type":"nope","operator":"all","children":[]}"#.utf8)
        XCTAssertThrowsError(try RuleJSON.decoder().decode(RuleNode.self, from: bad))
    }

    func testDecodesAStoredRuleWithServerFields() throws {
        let json = """
        {"id":"r1","name":"Rain","place":{"label":"Berlin","latitude":52.52,"longitude":13.41},
         "root":{"type":"group","operator":"all","children":[{"type":"condition","granularity":"hourly","variable":"rain","comparator":">","value":0.5,"quantifier":"any"}]},
         "paused":false,"armed":true,"lastEvaluatedAt":null,"lastFiredAt":"2024-05-01T12:00:00.000Z","createdAt":"2024-05-01T10:00:00.000Z","updatedAt":"2024-05-01T10:00:00.000Z"}
        """
        let rule = try RuleJSON.decoder().decode(Rule.self, from: Data(json.utf8))
        XCTAssertEqual(rule.id, "r1")
        XCTAssertFalse(rule.paused)
        XCTAssertNil(rule.lastEvaluatedAt)
        XCTAssertEqual(rule.lastFiredAt, "2024-05-01T12:00:00.000Z")
        XCTAssertNil(rule.definition.window)
        XCTAssertEqual(rule.definition.root.children.count, 1)
    }

    func testVariableCatalogueMatchesCore() {
        XCTAssertEqual(Variables.hourly.count, 20)
        XCTAssertEqual(Variables.daily.count, 16)
        XCTAssertEqual(Variables.find("weather_code", .daily)?.unit, "code")
        XCTAssertNil(Variables.find("temperature_2m", .daily))
        XCTAssertEqual(Set(Variables.all.map(\.id)).count, Variables.all.count, "ids are unique across granularities")
    }
}
