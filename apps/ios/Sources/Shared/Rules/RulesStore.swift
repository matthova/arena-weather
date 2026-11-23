import Foundation
import Observation
import WeatherAlertsKit

/// The signed-in user's rules, kept in sync with the API after every mutation.
@MainActor
@Observable
final class RulesStore {
    private(set) var rules: [Rule] = []
    private(set) var loaded = false
    var loading = false
    var error: String?

    func load(_ api: WeatherAPIClient) async {
        loading = true
        defer { loading = false }
        do {
            rules = try await api.listRules()
            loaded = true
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func upsert(_ rule: Rule) {
        if let i = rules.firstIndex(where: { $0.id == rule.id }) { rules[i] = rule } else { rules.insert(rule, at: 0) }
    }

    func remove(id: String) { rules.removeAll { $0.id == id } }

    func rule(id: String) -> Rule? { rules.first { $0.id == id } }

    func setPaused(_ rule: Rule, _ paused: Bool, _ api: WeatherAPIClient) async throws {
        upsert(paused ? try await api.pauseRule(rule.id) : try await api.resumeRule(rule.id))
    }

    func delete(_ rule: Rule, _ api: WeatherAPIClient) async throws {
        try await api.deleteRule(rule.id)
        remove(id: rule.id)
    }
}
