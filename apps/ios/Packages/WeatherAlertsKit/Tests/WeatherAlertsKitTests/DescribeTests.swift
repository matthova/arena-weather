import XCTest
@testable import WeatherAlertsKit

final class DescribeTests: XCTestCase {
    func testNumbersPrintLikeJavaScript() {
        XCTAssertEqual(Describe.number(60), "60")
        XCTAssertEqual(Describe.number(0.5), "0.5")
        XCTAssertEqual(Describe.number(-3), "-3")
        XCTAssertEqual(Describe.number(12.25), "12.25")
    }

    func testConditionWordingMatchesTheServer() {
        XCTAssertEqual(Describe.condition(variable: "precipitation_probability", granularity: .hourly, comparator: .greaterOrEqual, value: 60),
                       "Precipitation chance >= 60 %")
        XCTAssertEqual(Describe.condition(variable: "weather_code", granularity: .daily, comparator: .equal, value: 95),
                       "Weather code (WMO) == 95")
        XCTAssertEqual(Describe.condition(variable: "uv_index", granularity: .hourly, comparator: .greaterThan, value: 7),
                       "UV index > 7")
        XCTAssertEqual(Describe.condition(variable: "made_up", granularity: .hourly, comparator: .lessThan, value: 1), "made_up < 1")
    }

    func testEvaluationText() throws {
        let def = try RuleJSON.decoder().decode(RuleDefinition.self, from: Data(RuleCodableTests.readmeRule.utf8))
        let holds = ConditionResult(granularity: .hourly, variable: "precipitation_probability", comparator: .greaterOrEqual, value: 60,
                                    holds: true, sampleCount: 12, matchCount: 3, firstMatch: Sample(time: 1, value: 70))
        let fails = ConditionResult(granularity: .hourly, variable: "wind_gusts_10m", comparator: .greaterThan, value: 50,
                                    holds: false, sampleCount: 12, matchCount: 0)
        let evaluation = RuleEvaluation(matched: true, evaluatedAt: 1, root: GroupResult(op: .all, holds: true, children: [.condition(holds), .condition(fails)]))
        XCTAssertEqual(Describe.evaluation(def, evaluation), "Precipitation chance >= 60 % in Berlin")
        let none = RuleEvaluation(matched: false, evaluatedAt: 1, root: GroupResult(op: .all, holds: false, children: [.condition(fails)]))
        XCTAssertEqual(Describe.evaluation(def, none), "Wet and windy evening — conditions not met in Berlin")
    }

    func testSummaryAndWindow() throws {
        let def = try RuleJSON.decoder().decode(RuleDefinition.self, from: Data(RuleCodableTests.readmeRule.utf8))
        XCTAssertEqual(Describe.summary(def.root),
                       "Precipitation chance >= 60 % and (Wind gusts (10 m) > 50 km/h or Weather code (WMO) == 95)")
        XCTAssertEqual(Describe.window(def.window), "next 12 h, 17:00–22:59")
        XCTAssertEqual(Describe.window(nil), "Next 24 hours / 7 days")
        XCTAssertEqual(Describe.window(TimeWindow(daysAhead: 1)), "today")
    }

    func testEvaluationDecodes() throws {
        let json = """
        {"matched":true,"evaluatedAt":1700000000,"root":{"type":"group","operator":"all","holds":true,"children":[
          {"type":"condition","granularity":"hourly","variable":"rain","comparator":">","value":0.5,"quantifier":"any","holds":true,"sampleCount":12,"matchCount":2,"firstMatch":{"time":1700003600,"value":1.2}},
          {"type":"group","operator":"any","holds":false,"children":[
            {"type":"condition","granularity":"daily","variable":"uv_index_max","comparator":">","value":7,"quantifier":"all","holds":false,"sampleCount":0,"matchCount":0,"firstMatch":null,"missingVariable":true}
          ]}
        ]}}
        """
        let e = try RuleJSON.decoder().decode(RuleEvaluation.self, from: Data(json.utf8))
        XCTAssertTrue(e.matched)
        guard case .condition(let first) = e.root.children[0] else { return XCTFail() }
        XCTAssertEqual(first.firstMatch?.value, 1.2)
        guard case .group(let g) = e.root.children[1], case .condition(let missing) = g.children[0] else { return XCTFail() }
        XCTAssertEqual(missing.missingVariable, true)
        XCTAssertNil(missing.firstMatch)
        XCTAssertEqual(missing.quantifier, .all)
    }

    func testForecastHelpers() throws {
        let json = """
        {"latitude":52.5,"longitude":13.4,"timezone":"Europe/Berlin","utcOffsetSeconds":7200,"units":{"temperature_2m":"°C"},
         "current":{"time":1700000000,"values":{"temperature_2m":12.4,"weather_code":3,"is_day":1,"wind_gusts_10m":null}},
         "hourly":{"time":[1699999200,1700002800,1700006400],"values":{"temperature_2m":[10,null,12]}},
         "daily":{"time":[1699999200],"values":{"temperature_2m_max":[14]}}}
        """
        let f = try RuleJSON.decoder().decode(Forecast.self, from: Data(json.utf8))
        XCTAssertEqual(f.current?["temperature_2m"], 12.4)
        XCTAssertNil(f.current?["wind_gusts_10m"])
        XCTAssertNil(f.current?["missing"])
        XCTAssertEqual(f.hourly.value("temperature_2m", at: 1), nil)
        XCTAssertEqual(f.hourly.value("temperature_2m", at: 2), 12)
        XCTAssertEqual(f.upcomingHourIndices(hours: 24, now: Date(timeIntervalSince1970: 1700003000)), [1, 2])
        XCTAssertEqual(f.timeZone.identifier, "Europe/Berlin")
        XCTAssertEqual(WeatherFormat.temperature(12.4, unit: "°C"), "12°C")
        XCTAssertEqual(WeatherFormat.number(nil), "–")
        XCTAssertEqual(WeatherFormat.number(3.14159, unit: "mm", digits: 1), "3.1 mm")
        XCTAssertEqual(WeatherFormat.compass(90), "E")
        XCTAssertEqual(WeatherFormat.describe(code: 95).text, "Thunderstorm")
        XCTAssertEqual(WeatherFormat.describe(code: 0, isDay: false).symbol, "moon.stars")
    }
}
