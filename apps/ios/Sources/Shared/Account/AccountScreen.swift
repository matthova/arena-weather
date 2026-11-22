import SwiftUI
import WeatherAlertsKit

/// Account tab: who is signed in, notifications for this device, registered devices, the server.
struct AccountScreen: View {
    @Environment(AppModel.self) private var model
    @State private var showSignIn = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                switch model.session {
                case .unknown:
                    Section { HStack { ProgressView(); Text("Checking your session…") } }
                case .signedOut:
                    Section {
                        Button("Sign in") { showSignIn = true }
                    } footer: {
                        Text("Rules and notifications need an account — the same one as on the web.")
                    }
                case .signedIn(let user):
                    Section("Signed in as") {
                        LabeledContent("Name", value: user.name)
                        LabeledContent("E-mail", value: user.email)
                    }
                    NotificationsSection()
                    RegisteredDevicesSection()
                    Section {
                        Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                    }
                }
                ServerSection()
                AboutSection()
            }
            .navigationTitle("Account")
            .safeAreaInset(edge: .top) {
                if let banner = model.banner { BannerView(text: banner) }
            }
            .sheet(isPresented: $showSignIn) {
                NavigationStack { SignInView() }
            }
            .errorAlert($error)
        }
    }
}

/// Enable / disable push for this device, with the state spelled out.
struct NotificationsSection: View {
    @Environment(AppModel.self) private var model
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Section {
            switch model.pushState {
            case .unknown:
                HStack { ProgressView(); Text("Checking notification status…") }
            case .off:
                Button {
                    Task { await enable() }
                } label: {
                    HStack { Label("Enable notifications on this device", systemImage: "bell.badge"); Spacer(); if busy { ProgressView() } }
                }
                .disabled(busy)
            case .denied:
                Label("Notifications are off for this app", systemImage: "bell.slash").foregroundStyle(.secondary)
                Button("Try again") { Task { await enable() } }.disabled(busy)
            case .on(let token, let deliverable):
                Label("This device is registered", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                if !deliverable {
                    Label("The server has no APNs key yet, so nothing can be delivered to it. See README → iOS app.", systemImage: "exclamationmark.triangle")
                        .font(.footnote).foregroundStyle(.orange)
                }
                LabeledContent("Token", value: "\(token.prefix(8))…\(token.suffix(6))").font(.footnote.monospaced())
                Button("Turn off for this device", role: .destructive) { Task { await disable() } }.disabled(busy)
            }
        } header: {
            Text("Notifications")
        } footer: {
            Text("Environment: \(model.push.environment). The 15-minute checker sends one push to every registered device when a rule becomes true; “Test this rule now” sends one immediately.")
        }
        .errorAlert($error)
    }

    private func enable() async {
        busy = true
        defer { busy = false }
        do { try await model.enablePush() } catch { self.error = error.localizedDescription }
    }

    private func disable() async {
        busy = true
        defer { busy = false }
        do { try await model.disablePush() } catch { self.error = error.localizedDescription }
    }
}

/// Every push registration on the account (browsers, phones), with unregister.
struct RegisteredDevicesSection: View {
    @Environment(AppModel.self) private var model
    @State private var devices: [PushSubscriptionInfo] = []
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        Section {
            if !loaded {
                HStack { ProgressView(); Text("Loading…") }
            } else if devices.isEmpty {
                Text("No devices registered yet.").foregroundStyle(.secondary)
            } else {
                ForEach(devices) { device in
                    HStack {
                        Image(systemName: icon(device.resolvedChannel))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(device.userAgent?.isEmpty == false ? device.userAgent! : device.resolvedChannel).lineLimit(1)
                            Text("\(device.resolvedChannel)\(device.environment.map { " · \($0)" } ?? "") · \(WeatherFormat.isoDate(device.createdAt) ?? device.createdAt)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions {
                        Button(role: .destructive) { Task { await remove(device) } } label: { Label("Unregister", systemImage: "trash") }
                    }
                }
            }
        } header: {
            Text("Registered devices")
        } footer: {
            Text("Swipe to unregister. Browsers appear here too.")
        }
        .task(id: model.pushState) { await load() }
        .errorAlert($error)
    }

    private func icon(_ channel: String) -> String {
        switch channel {
        case "apns": return "iphone"
        case "fcm": return "candybarphone"
        default: return "globe"
        }
    }

    private func load() async {
        do {
            devices = try await model.api.listPushSubscriptions()
            loaded = true
        } catch {
            loaded = true
            self.error = error.localizedDescription
        }
    }

    private func remove(_ device: PushSubscriptionInfo) async {
        do {
            try await model.api.unregisterPush(token: device.endpoint)
            devices.removeAll { $0.id == device.id }
            if case .on(let token, _) = model.pushState, token == device.endpoint { try await model.disablePush() }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Which API the app talks to. Localhost works in the simulator; a device needs the Mac's LAN address or a deployed Worker.
struct ServerSection: View {
    @Environment(AppModel.self) private var model
    @State private var text = ""
    @State private var editing = false
    @State private var error: String?

    var body: some View {
        Section {
            if editing {
                TextField("https://arena-weather-api.<account>.workers.dev", text: $text)
                    .emailField()
                    .textContentType(.URL)
                HStack {
                    Button("Use this server") { Task { await apply() } }.disabled(URL(string: text.trimmingCharacters(in: .whitespaces))?.host == nil)
                    Spacer()
                    Button("Cancel") { editing = false }
                }
            } else {
                LabeledContent("API", value: model.serverURL.absoluteString).lineLimit(1).truncationMode(.middle)
                if let config = model.config {
                    LabeledContent("Google sign-in", value: config.googleSignIn ? "configured" : "not configured")
                    LabeledContent("APNs", value: config.pushChannels.map { $0.apns ? "configured" : "not configured" } ?? "unknown (older API)")
                }
                Button("Change server…") { text = model.serverURL.absoluteString; editing = true }
            }
        } header: {
            Text("Server")
        } footer: {
            Text("Changing the server signs you out. In the simulator http://localhost:8787 reaches `pnpm dev` on this Mac; on a device use the Mac's LAN address (http://192.168.x.x:8787) or the deployed API.")
        }
        .errorAlert($error)
    }

    private func apply() async {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespaces)), url.host != nil else { return }
        editing = false
        await model.changeServer(to: url)
    }
}

struct AboutSection: View {
    var body: some View {
        Section {
            LabeledContent("Version", value: (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev") +
                           " (" + (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") + ")")
            Link("Open-Meteo (forecast data)", destination: URL(string: "https://open-meteo.com")!)
        } header: {
            Text("About")
        }
    }
}
