import SwiftUI
import WeatherAlertsKit

/// One rule: what it says, pause/resume/delete, edit, and "Test this rule now" with the evaluation tree.
struct RuleDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let ruleID: String
    let store: RulesStore

    @State private var editing = false
    @State private var testing = false
    @State private var result: RuleTestResponse?
    @State private var error: String?
    @State private var confirmDelete = false

    private var rule: Rule? { store.rule(id: ruleID) }

    var body: some View {
        Group {
            if let rule {
                content(rule)
            } else if store.loaded {
                ContentUnavailableView("Rule not found", systemImage: "questionmark.circle")
            } else {
                ProgressView()
            }
        }
        .navigationTitle(rule?.name ?? "Rule")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            if rule != nil {
                ToolbarItem(placement: .primaryAction) { Button("Edit") { editing = true } }
            }
        }
        .sheet(isPresented: $editing) {
            if let rule {
                NavigationStack {
                    RuleEditorView(store: store, existing: rule, suggestedPlace: nil) { _ in result = nil }
                }
            }
        }
        .confirmationDialog("Delete this rule?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await delete() } }
        }
        .errorAlert($error)
        .task {
            if !store.loaded { await store.load(model.api) }
        }
    }

    private func content(_ rule: Rule) -> some View {
        List {
            Section {
                LabeledContent("Place", value: rule.place.label)
                LabeledContent("Window", value: Describe.window(rule.window))
                LabeledContent("State", value: rule.paused ? "Paused" : (rule.armed ? "Armed — fires when it becomes true" : "Fired — re-arms when it becomes false"))
                if let fired = WeatherFormat.isoDate(rule.lastFiredAt) { LabeledContent("Last fired", value: fired) }
                if let evaluated = WeatherFormat.isoDate(rule.lastEvaluatedAt) { LabeledContent("Last checked", value: evaluated) }
            }

            Section("Conditions") {
                RuleTreeView(group: rule.root)
            }

            Section {
                Button {
                    Task { await test(rule) }
                } label: {
                    HStack {
                        Label("Test this rule now", systemImage: "bolt.fill")
                        Spacer()
                        if testing { ProgressView() }
                    }
                }
                .disabled(testing)
                if let result {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            HoldsMark(holds: result.evaluation.matched)
                            Text(result.evaluation.matched ? "The rule holds right now" : "The rule does not hold right now").font(.subheadline.weight(.semibold))
                        }
                        Text(result.message).font(.footnote)
                        Text(pushSummary(result.push)).font(.caption).foregroundStyle(.secondary)
                        Divider()
                        EvaluationTreeView(evaluation: result.evaluation, timeZone: TimeZone(identifier: rule.place.timezone ?? "") ?? .current)
                    }
                    .padding(.vertical, 4)
                }
            } footer: {
                Text("Evaluates against the live forecast and sends the notification to every device on your account, whatever the trigger state.")
            }

            Section {
                Button(rule.paused ? "Resume" : "Pause") { Task { await toggle(rule) } }
                Button("Delete rule", role: .destructive) { confirmDelete = true }
            }
        }
    }

    private func pushSummary(_ push: PushCounts) -> String {
        if push.attempted == 0 { return "No devices registered for notifications — enable them in Account." }
        var s = "Notification sent to \(push.delivered) of \(push.attempted) device\(push.attempted == 1 ? "" : "s")"
        if push.failed > 0 { s += " (\(push.failed) failed; the API may lack the APNs key, see Account)" }
        return s
    }

    private func test(_ rule: Rule) async {
        testing = true
        defer { testing = false }
        do {
            let r = try await model.api.testRule(rule.id)
            result = r
            store.upsert(r.rule)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func toggle(_ rule: Rule) async {
        do { try await store.setPaused(rule, !rule.paused, model.api) } catch { self.error = error.localizedDescription }
    }

    private func delete() async {
        guard let rule else { return }
        do {
            try await store.delete(rule, model.api)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Read-only rendering of a rule's condition tree.
struct RuleTreeView: View {
    let group: ConditionGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(group.op.label).font(.subheadline.weight(.semibold))
            ForEach(Array(group.children.enumerated()), id: \.offset) { _, child in
                switch child {
                case .condition(let c):
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Image(systemName: c.granularity == .hourly ? "clock" : "calendar").foregroundStyle(.secondary).font(.caption)
                        Text(Describe.condition(c)).font(.subheadline)
                        if c.quantifier == .all { Text("(all samples)").font(.caption).foregroundStyle(.secondary) }
                    }
                case .group(let g):
                    RuleTreeView(group: g)
                }
            }
            .padding(.leading, 16)
        }
    }
}
