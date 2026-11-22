import SwiftUI
import WeatherAlertsKit

/// Search a place (Open-Meteo geocoding through the API) or use the device location; calls `onPick`.
struct PlaceSearchView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let onPick: (Place) -> Void

    @State private var query = ""
    @State private var results: [PlaceSearchResult] = []
    @State private var searching = false
    @State private var locating = false
    @State private var error: String?
    @State private var location = LocationService()

    var body: some View {
        List {
            Section {
                Button {
                    Task { await useLocation() }
                } label: {
                    HStack {
                        Label("Use my location", systemImage: "location.fill")
                        Spacer()
                        if locating { ProgressView() }
                    }
                }
                .disabled(locating)
            }
            Section {
                if searching && results.isEmpty {
                    HStack { ProgressView(); Text("Searching…").foregroundStyle(.secondary) }
                } else if !query.isEmpty && results.isEmpty && !searching {
                    Text("No places match “\(query)”").foregroundStyle(.secondary)
                }
                ForEach(results) { result in
                    Button {
                        pick(result.place)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(result.name).font(.body)
                            Text(result.label).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .tint(.primary)
                }
            } header: {
                if !results.isEmpty { Text("Places") }
            }
        }
        .navigationTitle("Choose a place")
        .searchAlwaysVisible(text: $query, prompt: "City or town")
        .task(id: query) { await search() }
        .errorAlert($error)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        }
    }

    private func pick(_ place: Place) {
        onPick(place)
        dismiss()
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { results = []; return }
        try? await Task.sleep(for: .milliseconds(300))   // debounce; cancelled when the query changes
        guard !Task.isCancelled else { return }
        searching = true
        defer { searching = false }
        do {
            let found = try await model.api.searchPlaces(q)
            if !Task.isCancelled { results = found }
        } catch is CancellationError {
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }

    private func useLocation() async {
        locating = true
        defer { locating = false }
        do {
            pick(try await location.currentPlace())
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension View {
    /// The search field shown immediately (iOS puts it in the navigation bar drawer).
    @ViewBuilder
    func searchAlwaysVisible(text: Binding<String>, prompt: String) -> some View {
        #if os(iOS)
        searchable(text: text, placement: .navigationBarDrawer(displayMode: .always), prompt: Text(prompt))
        #else
        searchable(text: text, prompt: Text(prompt))
        #endif
    }
}
