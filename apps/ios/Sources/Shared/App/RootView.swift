import SwiftUI
import WeatherAlertsKit

/// The app's three tabs. Shared by iOS now and macOS later (a sidebar split view can wrap the same screens).
public struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var tab: Tab = .forecast

    public enum Tab: Hashable { case forecast, rules, account }

    public init() {}

    public var body: some View {
        TabView(selection: $tab) {
            ForecastScreen()
                .tabItem { Label("Forecast", systemImage: "cloud.sun") }
                .tag(Tab.forecast)
            RulesScreen()
                .tabItem { Label("Rules", systemImage: "bell.badge") }
                .tag(Tab.rules)
            AccountScreen()
                .tabItem { Label("Account", systemImage: "person.crop.circle") }
                .tag(Tab.account)
        }
        .task { await model.bootstrap() }
        .onChange(of: model.pendingRuleID) { _, id in
            if id != nil { tab = .rules }
        }
        .onOpenURL { url in
            Task { try? await model.handleIncomingURL(url) }
        }
    }
}

/// A one-line problem strip under a navigation bar.
struct BannerView: View {
    let text: String
    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle")
            .font(.footnote)
            .foregroundStyle(.orange)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal)
            .padding(.vertical, 6)
            .background(.orange.opacity(0.12))
    }
}

/// Shown in place of a signed-in screen.
struct SignInRequiredView: View {
    let what: String
    @State private var showSignIn = false

    var body: some View {
        ContentUnavailableView {
            Label("Sign in to \(what)", systemImage: "person.crop.circle.badge.questionmark")
        } description: {
            Text("Rules and notifications belong to your account, the same one as on the web.")
        } actions: {
            Button("Sign in") { showSignIn = true }
                .buttonStyle(.borderedProminent)
        }
        .sheet(isPresented: $showSignIn) {
            NavigationStack { SignInView() }
        }
    }
}

extension View {
    /// `.alert` for a `String?` error message.
    func errorAlert(_ message: Binding<String?>) -> some View {
        alert("Something went wrong", isPresented: Binding(get: { message.wrappedValue != nil }, set: { if !$0 { message.wrappedValue = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message.wrappedValue ?? "")
        }
    }
}
