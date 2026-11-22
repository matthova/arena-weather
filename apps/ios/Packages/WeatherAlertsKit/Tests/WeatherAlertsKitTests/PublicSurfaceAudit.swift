import Foundation
import WeatherAlertsKit   // deliberately NOT @testable: this file sees only the public surface

// Every Kit API the app target (Sources/Shared, Sources/iOS) uses, compiled as an external client, so a
// missing `public` (memberwise inits are internal by default) fails `swift test` instead of xcodebuild on CI.
// Never called; it only has to type-check. Keep it in step with the app code.
@MainActor
func audit(api: WeatherAPIClient, rule: Rule, forecast: Forecast, config: ServerConfig, test: RuleTestResponse,
           device: PushSubscriptionInfo, draft: RuleDraft, group: GroupDraft, condition: ConditionDraft) async throws {
    // RuleEditorView / GroupEditorView / ConditionEditorRow
    var errors = DraftErrors()
    _ = errors.messages; _ = errors.nodes; _ = errors.isEmpty; _ = errors.summary
    let d = RuleDraft(place: nil)
    _ = RuleDraft(rule.definition)
    d.name = "x"; d.place = Place(label: "B", latitude: 1, longitude: 2, timezone: nil)
    d.hoursAhead = ""; d.daysAhead = ""; d.useHoursOfDay = true; d.hoursFrom = 1; d.hoursTo = 2
    switch d.definition() { case .success(let def): _ = def.name; case .failure(let e): errors = e }
    group.op = .any; group.addCondition(); group.addGroup(.all); group.remove(id: condition.id); _ = group.children.count; _ = group.id
    for child in group.children { switch child { case .condition(let c): _ = c.id; case .group(let g): _ = g.id } }
    condition.setGranularity(.daily); condition.variable = "x"; condition.comparator = .equal; condition.value = "1"; condition.quantifier = .all
    _ = condition.weatherVariable?.showsUnit; _ = condition.weatherVariable?.unit
    _ = Variables.list(for: .hourly).map { "\($0.label) \($0.unit) \($0.name) \($0.id)" }
    _ = WeatherAlertsKit.Comparator.allCases.map { "\($0.label) \($0.rawValue)" }
    _ = Granularity.allCases.map(\.label); _ = GroupOperator.allCases.map(\.label); _ = Quantifier.allCases.map(\.label)
    _ = RuleLimits.maxGroupChildren; _ = RuleLimits.maxGroupDepth
    _ = try await api.createRule(def(d)); _ = try await api.updateRule(rule.id, def(d))
    // RulesScreen / RuleRow / RuleDetailView / RuleTreeView
    _ = rule.id; _ = rule.name; _ = rule.paused; _ = rule.armed; _ = rule.place.label; _ = rule.window; _ = rule.root; _ = rule.lastFiredAt; _ = rule.lastEvaluatedAt
    _ = Describe.summary(rule.root); _ = Describe.window(rule.window); _ = rule.root.op.label
    for child in rule.root.children { switch child { case .condition(let c): _ = Describe.condition(c); _ = c.granularity == .hourly; _ = c.quantifier == .all; case .group(let g): _ = g.op } }
    _ = try await api.listRules(); _ = try await api.pauseRule(rule.id); _ = try await api.resumeRule(rule.id); try await api.deleteRule(rule.id)
    let t = try await api.testRule(rule.id); _ = t.rule; _ = t.message; _ = t.push.attempted; _ = t.push.delivered; _ = t.push.failed; _ = t.evaluation.matched
    _ = TimeZone(identifier: rule.place.timezone ?? "")
    _ = WeatherFormat.isoDate(rule.lastFiredAt)
    // EvaluationTreeView
    func walk(_ n: NodeResult) { switch n { case .group(let g): _ = g.holds; _ = g.op == .all; g.children.forEach(walk); case .condition(let c): _ = c.holds; _ = Describe.condition(c); _ = c.missingVariable == true; _ = c.matchCount; _ = c.sampleCount; _ = c.granularity; _ = c.quantifier == .all; if let f = c.firstMatch { _ = WeatherFormat.dateTime(f.time, timeZone: .current); _ = Describe.number(f.value) } } }
    walk(.group(test.evaluation.root))
    // Forecast screens
    _ = try await api.forecast(latitude: 1, longitude: 2, timezone: nil)
    _ = try await api.searchPlaces("q").map { ($0.name, $0.label, $0.place) }
    let cur = forecast.current; _ = cur?["weather_code"]; _ = cur?.time; _ = forecast.timeZone; _ = forecast.unit("x", fallback: "y")
    _ = WeatherFormat.describe(code: cur?["weather_code"], isDay: true).text; _ = WeatherFormat.describe(code: nil).symbol
    _ = WeatherFormat.temperature(nil, unit: "°C"); _ = WeatherFormat.number(nil, unit: "%"); _ = WeatherFormat.number(nil, unit: "mm", digits: 1); _ = WeatherFormat.compass(nil)
    _ = WeatherFormat.time(1, timeZone: .current); _ = WeatherFormat.hour(1, timeZone: .current); _ = WeatherFormat.day(1, timeZone: .current, now: Date())
    for i in forecast.upcomingHourIndices(hours: 24, now: Date()) { _ = forecast.hourly.value("temperature_2m", at: i); _ = forecast.hourly.time[i] }
    _ = forecast.daily.time.prefix(7); _ = forecast.daily.value("weather_code", at: 0)
    // Auth / Account
    _ = try await api.signIn(email: "a", password: "b"); try await api.signUp(name: "n", email: "a", password: "b")
    try await api.sendVerificationEmail(email: "a"); _ = try await api.devOutbox(to: "a").first?.firstLink
    try await api.openVerificationLink(URL(string: "http://x")!)
    _ = api.nativeHandoffURL(redirect: "s://a"); _ = try await api.socialSignInURL(provider: "google", callbackURL: "x"); try await api.verifyOneTimeToken("o")
    await api.signOut(); _ = api.isSignedIn; _ = api.baseURL; api.setBaseURL(URL(string: "http://y")!); api.tokens.clear(); _ = api.tokens.load()
    _ = try await api.me()?.email; _ = try await api.config()
    _ = config.googleSignIn; _ = config.devMailbox; _ = config.apnsConfigured; _ = config.pushChannels?.apns; _ = config.appUrl
    let r = try await api.registerAPNs(token: "t", deviceDescription: "d"); _ = r.deliverable; _ = r.device.channel
    try await api.unregisterDevice(token: "t"); try await api.unregisterWebPush(endpoint: "e")
    _ = try await api.listPushSubscriptions(); _ = device.id; _ = device.resolvedChannel; _ = device.endpoint; _ = device.userAgent; _ = device.createdAt
    _ = APIError(status: 0, code: "c", message: "m").isEmailNotVerified; _ = APIError(status: 401, code: "c", message: "m").isUnauthorized
    let store: TokenStore = KeychainTokenStoreOrMemory(); _ = WeatherAPIClient(baseURL: URL(string: "http://x")!, tokens: store, userAgent: "ua")
}
func def(_ d: RuleDraft) throws -> RuleDefinition { try d.definition().get() }
#if canImport(Security)
func KeychainTokenStoreOrMemory() -> TokenStore { KeychainTokenStore() }
#else
func KeychainTokenStoreOrMemory() -> TokenStore { InMemoryTokenStore() }
#endif
