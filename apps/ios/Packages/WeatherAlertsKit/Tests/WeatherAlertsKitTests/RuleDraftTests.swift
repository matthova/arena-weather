import XCTest
@testable import WeatherAlertsKit

/// Mirrors apps/web/src/lib/rule-draft.test.ts: the builder state must produce exactly the core JSON.
final class RuleDraftTests: XCTestCase {
    let berlin = Place(label: "Berlin", latitude: 52.52, longitude: 13.41, timezone: "Europe/Berlin")

    func testDefaultDraftSerialisesToAValidRule() throws {
        let draft = RuleDraft(name: "Rain", place: berlin)
        let def = try draft.definition().get()
        XCTAssertEqual(def.name, "Rain")
        XCTAssertNil(def.window, "an untouched window is omitted")
        XCTAssertEqual(def.root.op, .all)
        guard case .condition(let c) = def.root.children.first else { return XCTFail("one default condition") }
        XCTAssertEqual(c.variable, "precipitation_probability")
        XCTAssertEqual(c.comparator, .greaterOrEqual)
        XCTAssertEqual(c.value, 60)
        XCTAssertNil(c.quantifier, "\"any\" is the default and stays off the wire")
    }

    func testWindowAndNestedGroups() throws {
        let draft = RuleDraft(name: "  Windy  ", place: berlin, hoursAhead: "12", daysAhead: "3", useHoursOfDay: true, hoursFrom: 22, hoursTo: 6)
        let nested = GroupDraft(op: .any, children: [
            .condition(ConditionDraft(granularity: .hourly, variable: "wind_gusts_10m", comparator: .greaterThan, value: "50")),
            .condition(ConditionDraft(granularity: .daily, variable: "weather_code", comparator: .equal, value: "95", quantifier: .all)),
        ])
        draft.root.children.append(.group(nested))
        let def = try draft.definition().get()
        XCTAssertEqual(def.name, "Windy")
        XCTAssertEqual(def.window, TimeWindow(hoursAhead: 12, daysAhead: 3, hoursOfDay: HoursOfDay(from: 22, to: 6)))
        XCTAssertEqual(def.root.children.count, 2)
        guard case .group(let g) = def.root.children[1], case .condition(let last) = g.children[1] else { return XCTFail("nested") }
        XCTAssertEqual(g.op, .any)
        XCTAssertEqual(last.quantifier, .all)
        XCTAssertEqual(last.granularity, .daily)
    }

    func testAcceptsCommaDecimalsAndTrimsText() throws {
        let draft = RuleDraft(name: "Drizzle", place: berlin)
        draft.root.children = [.condition(ConditionDraft(variable: "rain", comparator: .greaterThan, value: " 0,5 "))]
        let def = try draft.definition().get()
        guard case .condition(let c) = def.root.children[0] else { return XCTFail() }
        XCTAssertEqual(c.value, 0.5)
    }

    func testReportsWhatIsMissing() {
        let draft = RuleDraft()
        draft.root.children = []
        guard case .failure(let errors) = draft.definition() else { return XCTFail("must fail") }
        XCTAssertTrue(errors.messages.contains("Give the rule a name"))
        XCTAssertTrue(errors.messages.contains("Pick a place"))
        XCTAssertEqual(errors.nodes[draft.root.id], "Add at least one condition to this group")
    }

    func testFlagsBadNumbersPerCondition() {
        let draft = RuleDraft(name: "x", place: berlin)
        let bad = ConditionDraft(value: "abc")
        draft.root.children = [.condition(bad), .condition(ConditionDraft(value: "1"))]
        guard case .failure(let errors) = draft.definition() else { return XCTFail("must fail") }
        XCTAssertEqual(errors.nodes[bad.id], "Enter a number")
        XCTAssertEqual(errors.nodes.count, 1)
        XCTAssertTrue(errors.messages.isEmpty)
    }

    func testEnforcesTheSchemaRanges() {
        let draft = RuleDraft(name: "x", place: berlin, hoursAhead: "200", daysAhead: "0")
        guard case .failure(let errors) = draft.definition() else { return XCTFail("must fail") }
        XCTAssertTrue(errors.messages.contains { $0.hasPrefix("Hours ahead") })
        XCTAssertTrue(errors.messages.contains { $0.hasPrefix("Days ahead") })

        let unknownVariable = RuleDraft(name: "x", place: berlin)
        let c = ConditionDraft(granularity: .daily, variable: "temperature_2m", value: "1")
        unknownVariable.root.children = [.condition(c)]
        guard case .failure(let e2) = unknownVariable.definition() else { return XCTFail("must fail") }
        XCTAssertEqual(e2.nodes[c.id], "Pick a variable")

        let deep = RuleDraft(name: "x", place: berlin)
        var group = deep.root
        for _ in 0..<5 { let g = GroupDraft(); group.children = [.group(g)]; group = g }
        XCTAssertEqual(deep.root.depth, 6)
        guard case .failure(let e3) = deep.definition() else { return XCTFail("must fail") }
        XCTAssertTrue(e3.nodes.values.contains { $0.contains("nested at most 5") })
    }

    func testSwitchingGranularityKeepsOrReplacesTheVariable() {
        let c = ConditionDraft(granularity: .hourly, variable: "weather_code")
        c.setGranularity(.daily)
        XCTAssertEqual(c.variable, "weather_code", "exists in both lists")
        c.setGranularity(.hourly)
        c.variable = "temperature_2m"
        c.setGranularity(.daily)
        XCTAssertEqual(c.variable, Variables.daily.first?.name)
    }

    func testDraftFromDefinitionRoundTrips() throws {
        let def = try RuleJSON.decoder().decode(RuleDefinition.self, from: Data(RuleCodableTests.readmeRule.utf8))
        let draft = RuleDraft(def)
        XCTAssertEqual(draft.hoursAhead, "12")
        XCTAssertEqual(draft.daysAhead, "")
        XCTAssertTrue(draft.useHoursOfDay)
        XCTAssertEqual(draft.hoursFrom, 17)
        XCTAssertEqual(draft.root.conditionCount, 3)
        XCTAssertEqual(try draft.definition().get(), def)
    }
}
