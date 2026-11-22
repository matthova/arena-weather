import Foundation
import Observation
import WeatherAlertsKit

public enum SessionState: Equatable {
    case unknown
    case signedOut
    case signedIn(APIUser)

    public var user: APIUser? {
        if case .signedIn(let u) = self { return u }
        return nil
    }
}

public enum PushState: Equatable {
    case unknown
    case off
    case denied
    /// Registered with the API; `deliverable` is false when the server has no APNs key yet.
    case on(token: String, deliverable: Bool)
}

/// App-wide state: the API client, the session, the server's capabilities, push registration and
/// deep links. One instance, created by the platform entry point and injected into the environment.
@MainActor
@Observable
public final class AppModel {
    public static let urlScheme = "weatheralerts"
    public static let googleCallback = "\(urlScheme)://auth/callback"

    public private(set) var api: WeatherAPIClient
    public private(set) var session: SessionState = .unknown
    public private(set) var config: ServerConfig?
    public private(set) var pushState: PushState = .unknown
    /// Set when a notification was tapped (or a `weatheralerts://rules/<id>` link opened); the rules tab navigates there.
    public var pendingRuleID: String?
    /// Last background problem worth telling the user about (server unreachable, …).
    public var banner: String?
    public var settings: AppSettings
    public let push: PushRegistrar

    public init(push: PushRegistrar, tokens: TokenStore, settings: AppSettings = AppSettings()) {
        self.push = push
        self.settings = settings
        self.api = WeatherAPIClient(baseURL: settings.serverURL, tokens: tokens, userAgent: Self.userAgent)
    }

    nonisolated static var userAgent: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
        return "WeatherAlerts/\(version)"
    }

    public var serverURL: URL { api.baseURL }
    public var isSignedIn: Bool { session.user != nil }

    // MARK: Lifecycle

    /// On launch: what the server offers, whether the stored token is still a session, re-register push.
    public func bootstrap() async {
        await loadConfig()
        await refreshSession()
    }

    public func loadConfig() async {
        do {
            config = try await api.config()
            banner = nil
        } catch {
            banner = "Cannot reach \(serverURL.host ?? serverURL.absoluteString): \(error.localizedDescription)"
        }
    }

    public func refreshSession() async {
        guard api.isSignedIn else {
            session = .signedOut
            pushState = .off
            return
        }
        do {
            if let user = try await api.me() {
                session = .signedIn(user)
                await syncPushAfterSignIn(prompt: false)
            } else {
                api.tokens.clear()
                session = .signedOut
            }
        } catch let error as APIError where error.isUnauthorized {
            api.tokens.clear()
            session = .signedOut
        } catch {
            // offline: keep whatever we knew, surface the problem
            if case .unknown = session { session = .signedOut }
            banner = error.localizedDescription
        }
    }

    // MARK: Account

    public func signIn(email: String, password: String) async throws {
        try await api.signIn(email: email, password: password)
        await refreshSession()
    }

    public func signUp(name: String, email: String, password: String) async throws {
        try await api.signUp(name: name, email: email, password: password)
    }

    /// Google: opens Better Auth's browser flow and finishes with the hand-off one-time token.
    public func signInWithGoogle(using authenticator: WebAuthenticating) async throws {
        let handoff = api.nativeHandoffURL(redirect: Self.googleCallback)
        let start = try await api.socialSignInURL(provider: "google", callbackURL: handoff.absoluteString)
        let callback = try await authenticator.authenticate(url: start, callbackScheme: Self.urlScheme)
        try await handleIncomingURL(callback)
    }

    /// `weatheralerts://auth/callback?ott=…` (Google hand-off) and `weatheralerts://rules/<id>`.
    public func handleIncomingURL(_ url: URL) async throws {
        guard url.scheme?.lowercased() == Self.urlScheme else { return }
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        switch url.host?.lowercased() {
        case "auth":
            guard let ott = parts?.queryItems?.first(where: { $0.name == "ott" })?.value, !ott.isEmpty else {
                throw APIError(status: 0, code: "no_ott", message: "The sign-in did not complete")
            }
            try await api.verifyOneTimeToken(ott)
            await refreshSession()
        case "rules":
            let id = url.pathComponents.filter { $0 != "/" }.first
            if let id { pendingRuleID = id }
        default:
            break
        }
    }

    public func signOut() async {
        if let token = settings.registeredPushToken {
            try? await api.unregisterPush(token: token)
            settings.registeredPushToken = nil
        }
        await api.signOut()
        session = .signedOut
        pushState = .off
    }

    /// Account → Server: point at another API. Signs out first (the token belongs to the old server).
    public func changeServer(to url: URL) async {
        if isSignedIn { await signOut() }
        api.tokens.clear()
        settings.serverURL = url
        api.setBaseURL(url)
        config = nil
        await bootstrap()
    }

    // MARK: Push

    /// User pressed "Enable notifications": permission prompt, APNs token, API registration.
    public func enablePush() async throws {
        do {
            let token = try await push.requestAndRegister()
            try await register(token: token)
        } catch PushError.denied {
            pushState = .denied
            throw PushError.denied
        }
    }

    public func disablePush() async throws {
        if let token = settings.registeredPushToken ?? currentToken {
            try await api.unregisterPush(token: token)
        }
        settings.registeredPushToken = nil
        pushState = .off
    }

    private var currentToken: String? {
        if case .on(let token, _) = pushState { return token }
        return nil
    }

    private func register(token: String) async throws {
        let response = try await api.registerAPNs(token: token, environment: push.environment, deviceDescription: push.deviceDescription)
        settings.registeredPushToken = token
        pushState = .on(token: token, deliverable: response.deliverable ?? true)
    }

    /// After sign-in / launch: if notifications are already allowed, (re)register the current token quietly.
    private func syncPushAfterSignIn(prompt: Bool) async {
        switch await push.authorizationStatus() {
        case .denied:
            pushState = .denied
        case .notDetermined:
            pushState = .off
        case .authorized:
            do {
                if let token = try await push.registerIfAuthorized() {
                    try await register(token: token)
                } else if let token = settings.registeredPushToken {
                    pushState = .on(token: token, deliverable: config?.apnsConfigured ?? true)
                } else {
                    pushState = .off
                }
            } catch {
                if let token = settings.registeredPushToken {
                    pushState = .on(token: token, deliverable: config?.apnsConfigured ?? true)
                } else {
                    pushState = .off
                }
            }
        }
    }
}
