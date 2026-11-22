import SwiftUI
import WeatherAlertsKit

/// Rules tab: list → detail; "+" opens the builder.
struct RulesScreen: View {
    @Environment(AppModel.self) private var model
    @State private var store = RulesStore()
    @State private var path: [String] = []
    @State private var creating = false
    @State private var error: String?

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                switch model.session {
                case .unknown:
                    ProgressView()
                case .signedOut:
                    SignInRequiredView(what: "see your rules")
                case .signedIn:
                    list
                }
            }
            .navigationTitle("Rules")
            .toolbar {
                if model.isSignedIn {
                    ToolbarItem(placement: .primaryAction) {
                        Button { creating = true } label: { Label("New rule", systemImage: "plus") }
                    }
                }
            }
            .navigationDestination(for: String.self) { id in
                RuleDetailView(ruleID: id, store: store)
            }
            .sheet(isPresented: $creating) {
                NavigationStack {
                    RuleEditorView(store: store, existing: nil, suggestedPlace: model.settings.lastPlace) { saved in
                        path = [saved.id]
                    }
                }
            }
            .task(id: model.isSignedIn) {
                if model.isSignedIn { await store.load(model.api) }
            }
            .onChange(of: model.pendingRuleID, initial: true) { _, id in
                guard let id, model.isSignedIn else { return }
                model.pendingRuleID = nil
                path = [id]
            }
            .errorAlert($error)
        }
        .environment(store)
    }

    @ViewBuilder
    private var list: some View {
        if store.loading && !store.loaded {
            ProgressView("Loading rules…")
        } else if let message = store.error, !store.loaded {
            ContentUnavailableView {
                Label("Rules unavailable", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await store.load(model.api) } }
            }
        } else if store.rules.isEmpty {
            ContentUnavailableView {
                Label("No rules yet", systemImage: "bell.slash")
            } description: {
                Text("Describe the weather you care about — “rain chance ≥ 60 % this evening” — and get one notification when it comes true.")
            } actions: {
                Button("Create a rule") { creating = true }.buttonStyle(.borderedProminent)
            }
        } else {
            List {
                ForEach(store.rules) { rule in
                    NavigationLink(value: rule.id) { RuleRow(rule: rule) }
                        .swipeActions(edge: .leading) {
                            Button {
                                Task { await toggle(rule) }
                            } label: {
                                Label(rule.paused ? "Resume" : "Pause", systemImage: rule.paused ? "play" : "pause")
                            }
                            .tint(rule.paused ? .green : .orange)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                Task { await delete(rule) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                }
            }
            .refreshable { await store.load(model.api) }
        }
    }

    private func toggle(_ rule: Rule) async {
        do { try await store.setPaused(rule, !rule.paused, model.api) } catch { self.error = error.localizedDescription }
    }

    private func delete(_ rule: Rule) async {
        do { try await store.delete(rule, model.api) } catch { self.error = error.localizedDescription }
    }
}

struct RuleRow: View {
    let rule: Rule

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(rule.name).font(.headline)
                Spacer()
                if rule.paused {
                    Text("Paused").font(.caption).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.orange.opacity(0.2), in: Capsule())
                } else if !rule.armed {
                    Text("Fired").font(.caption).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.blue.opacity(0.2), in: Capsule())
                }
            }
            Text(Describe.summary(rule.root)).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
            Text("\(rule.place.label) · \(Describe.window(rule.window))").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }
}
