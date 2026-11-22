import SwiftUI
import WeatherAlertsKit

/// The rule builder: name, place, optional time window, and the nested all/any tree of conditions.
/// Saves through `RuleDraft.definition()`, which produces the shared rule JSON.
struct RuleEditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let store: RulesStore
    let existing: Rule?
    let onSaved: (Rule) -> Void

    @State private var draft: RuleDraft
    @State private var errors = DraftErrors()
    @State private var choosingPlace = false
    @State private var saving = false
    @State private var error: String?

    init(store: RulesStore, existing: Rule?, suggestedPlace: Place?, onSaved: @escaping (Rule) -> Void) {
        self.store = store
        self.existing = existing
        self.onSaved = onSaved
        _draft = State(initialValue: existing.map { RuleDraft($0.definition) } ?? RuleDraft(place: suggestedPlace))
    }

    var body: some View {
        Form {
            Section("Name") {
                TextField("e.g. Wet and windy evening", text: $draft.name)
            }

            Section("Place") {
                Button { choosingPlace = true } label: {
                    HStack {
                        Label(draft.place?.label ?? "Choose a place", systemImage: "mappin.and.ellipse")
                            .foregroundStyle(draft.place == nil ? Color.accentColor : Color.primary)
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }
                }
            }

            Section {
                LabeledContent("Hours ahead") {
                    TextField("24", text: $draft.hoursAhead).multilineTextAlignment(.trailing).numericKeyboard().frame(maxWidth: 80)
                }
                LabeledContent("Days ahead") {
                    TextField("7", text: $draft.daysAhead).multilineTextAlignment(.trailing).numericKeyboard().frame(maxWidth: 80)
                }
                Toggle("Only certain hours of day", isOn: $draft.useHoursOfDay)
                if draft.useHoursOfDay {
                    Picker("From", selection: $draft.hoursFrom) {
                        ForEach(0..<24, id: \.self) { Text(String(format: "%02d:00", $0)) }
                    }
                    Picker("To", selection: $draft.hoursTo) {
                        ForEach(0..<24, id: \.self) { Text(String(format: "%02d:59", $0)) }
                    }
                }
            } header: {
                Text("Time window")
            } footer: {
                Text("Hourly conditions look at the next N hours (default 24, max 168); daily ones at the next N days (default 7, today = 1). A “from” later than “to” wraps past midnight.")
            }

            Section {
                GroupEditorView(group: draft.root, depth: 0, errors: errors.nodes, onRemove: nil)
            } header: {
                Text("Conditions")
            } footer: {
                if !errors.messages.isEmpty {
                    Text(errors.messages.joined(separator: "\n")).foregroundStyle(.red)
                } else {
                    Text("A condition holds when any forecast sample in the window satisfies it (or every sample, for “the whole time”). Nest groups to mix “all of” and “any of”.")
                }
            }
        }
        .navigationTitle(existing == nil ? "New rule" : "Edit rule")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
            ToolbarItem(placement: .confirmationAction) {
                if saving { ProgressView() } else { Button("Save") { Task { await save() } } }
            }
        }
        .sheet(isPresented: $choosingPlace) {
            NavigationStack {
                PlaceSearchView { picked in draft.place = picked }
            }
        }
        .errorAlert($error)
        .interactiveDismissDisabled(saving)
    }

    private func save() async {
        switch draft.definition() {
        case .failure(let found):
            errors = found
        case .success(let definition):
            errors = DraftErrors()
            saving = true
            defer { saving = false }
            do {
                let saved: Rule
                if let existing {
                    saved = try await model.api.updateRule(existing.id, definition)
                } else {
                    saved = try await model.api.createRule(definition)
                }
                store.upsert(saved)
                dismiss()
                onSaved(saved)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// One all/any group with its children; nests itself for sub-groups.
struct GroupEditorView: View {
    @Bindable var group: GroupDraft
    let depth: Int
    let errors: [UUID: String]
    let onRemove: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Picker("Combine", selection: $group.op) {
                    ForEach(GroupOperator.allCases, id: \.self) { Text($0.label) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 220)
                Spacer()
                if let onRemove {
                    Button(role: .destructive, action: onRemove) {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Remove group")
                }
            }
            if let message = errors[group.id] {
                Text(message).font(.caption).foregroundStyle(.red)
            }
            ForEach(group.children) { child in
                Group {
                    switch child {
                    case .condition(let condition):
                        ConditionEditorRow(condition: condition, error: errors[condition.id]) { group.remove(id: condition.id) }
                    case .group(let nested):
                        GroupEditorView(group: nested, depth: depth + 1, errors: errors) { group.remove(id: nested.id) }
                    }
                }
                .padding(10)
                .background(Color.secondary.opacity(depth % 2 == 0 ? 0.08 : 0.14), in: RoundedRectangle(cornerRadius: 10))
            }
            HStack {
                Button { group.addCondition() } label: { Label("Condition", systemImage: "plus") }
                if depth + 1 < RuleLimits.maxGroupDepth {
                    Button { group.addGroup(group.op == .all ? .any : .all) } label: { Label("Group", systemImage: "plus.rectangle.on.rectangle") }
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(group.children.count >= RuleLimits.maxGroupChildren)
        }
    }
}

/// One condition: granularity, variable, comparator, value, quantifier.
struct ConditionEditorRow: View {
    @Bindable var condition: ConditionDraft
    let error: String?
    let onRemove: () -> Void

    private var granularity: Binding<Granularity> {
        Binding(get: { condition.granularity }, set: { condition.setGranularity($0) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Picker("Granularity", selection: granularity) {
                    ForEach(Granularity.allCases, id: \.self) { Text($0.label) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 160)
                Spacer()
                Button(role: .destructive, action: onRemove) {
                    Image(systemName: "minus.circle")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Remove condition")
            }
            Picker("Variable", selection: $condition.variable) {
                ForEach(Variables.list(for: condition.granularity)) { variable in
                    Text(variable.showsUnit ? "\(variable.label) (\(variable.unit))" : variable.label).tag(variable.name)
                }
            }
            HStack {
                Picker("Is", selection: $condition.comparator) {
                    ForEach(Comparator.allCases, id: \.self) { Text("\($0.label) (\($0.rawValue))") }
                }
                .labelsHidden()
                TextField("Value", text: $condition.value)
                    .numericKeyboard()
                    .multilineTextAlignment(.trailing)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 110)
                if let unit = condition.weatherVariable, unit.showsUnit {
                    Text(unit.unit).foregroundStyle(.secondary)
                }
            }
            Picker("When", selection: $condition.quantifier) {
                ForEach(Quantifier.allCases, id: \.self) { Text($0.label) }
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(.red)
            }
        }
    }
}

extension View {
    /// Decimal keypad on iOS; no-op where there is a hardware keyboard.
    @ViewBuilder
    func numericKeyboard() -> some View {
        #if os(iOS)
        keyboardType(.numbersAndPunctuation)
        #else
        self
        #endif
    }
}
