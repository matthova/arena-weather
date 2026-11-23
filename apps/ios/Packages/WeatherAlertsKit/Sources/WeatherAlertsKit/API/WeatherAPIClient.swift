import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// An error the API answered with (`{ error: { code, message } }`, or Better Auth's `{ code, message }`).
public struct APIError: Error, LocalizedError, Equatable, Sendable {
    public let status: Int
    public let code: String
    public let message: String

    public init(status: Int, code: String, message: String) {
        self.status = status
        self.code = code
        self.message = message
    }

    public var errorDescription: String? { message }
    public var isUnauthorized: Bool { status == 401 }
    public var isEmailNotVerified: Bool { code == "EMAIL_NOT_VERIFIED" }
}

public enum HTTPMethod: String, Sendable { case GET, POST, PUT, DELETE }

/// The typed client for everything under `/api` (the Swift twin of `createWeatherClient` in packages/core).
/// Sends `Authorization: Bearer <token>` from the `TokenStore` when there is one; sign-in stores the
/// token the API returns in its `set-auth-token` header.
public final class WeatherAPIClient: @unchecked Sendable {
    public private(set) var baseURL: URL
    public let tokens: TokenStore
    public let userAgent: String
    private let session: URLSession
    private let encoder = RuleJSON.encoder()
    private let decoder = RuleJSON.decoder()

    public init(baseURL: URL, tokens: TokenStore, userAgent: String = "WeatherAlerts", session: URLSession? = nil) {
        self.baseURL = baseURL
        self.tokens = tokens
        self.userAgent = userAgent
        self.session = session ?? {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 30
            #if !canImport(FoundationNetworking)
            config.waitsForConnectivity = false
            #endif
            return URLSession(configuration: config)
        }()
    }

    /// Point at another server (Account → Server). Clears nothing: the caller signs out first.
    public func setBaseURL(_ url: URL) { baseURL = url }

    public var isSignedIn: Bool { tokens.load() != nil }

    // MARK: Transport

    public struct Response: Sendable {
        public let status: Int
        public let data: Data
        public let headers: [String: String]
    
    public init(status: Int, data: Data, headers: [String: String]) {
        self.status = status
        self.data = data
        self.headers = headers
    }
}

    private struct WrappedError: Decodable { struct Body: Decodable { let code: String; let message: String }; let error: Body }
    private struct FlatError: Decodable { let code: String?; let message: String? }

    public func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        let basePath = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = basePath + path
        components.queryItems = query.isEmpty ? nil : query
        return components.url!
    }

    public func send(_ method: HTTPMethod, _ path: String, query: [URLQueryItem] = [], body: Data? = nil,
                     headers: [String: String] = [:]) async throws -> Response {
        var request = URLRequest(url: url(path, query: query))
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue(userAgent, forHTTPHeaderField: "user-agent")
        // Better Auth checks the Origin of state-changing requests against its trusted origins.
        if method != .GET, let origin = originHeader { request.setValue(origin, forHTTPHeaderField: "origin") }
        if let token = tokens.load() { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: 0, code: "no_response", message: "No HTTP response")
        }
        var headerMap: [String: String] = [:]
        for (k, v) in http.allHeaderFields {
            if let key = k as? String, let value = v as? String { headerMap[key.lowercased()] = value }
        }
        if (200..<300).contains(http.statusCode) == false {
            throw Self.error(status: http.statusCode, data: data, decoder: decoder)
        }
        return Response(status: http.statusCode, data: data, headers: headerMap)
    }

    private var originHeader: String? {
        guard let scheme = baseURL.scheme, let host = baseURL.host else { return nil }
        if let port = baseURL.port { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }

    static func error(status: Int, data: Data, decoder: JSONDecoder) -> APIError {
        if let wrapped = try? decoder.decode(WrappedError.self, from: data) {
            return APIError(status: status, code: wrapped.error.code, message: wrapped.error.message)
        }
        if let flat = try? decoder.decode(FlatError.self, from: data), flat.code != nil || flat.message != nil {
            return APIError(status: status, code: flat.code ?? "http_\(status)", message: flat.message ?? "Request failed (\(status))")
        }
        if status == 401 { return APIError(status: 401, code: "unauthorized", message: "Sign in required") }
        return APIError(status: status, code: "http_\(status)", message: "Request failed with status \(status)")
    }

    func request<T: Decodable>(_ method: HTTPMethod, _ path: String, query: [URLQueryItem] = []) async throws -> T {
        let response = try await send(method, path, query: query, body: nil)
        return try decode(T.self, from: response.data)
    }

    func request<T: Decodable, B: Encodable>(_ method: HTTPMethod, _ path: String, query: [URLQueryItem] = [],
                                             body: B) async throws -> T {
        let response = try await send(method, path, query: query, body: try encoder.encode(body))
        return try decode(T.self, from: response.data)
    }

    func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError(status: 200, code: "bad_json", message: "Unexpected response: \(error.localizedDescription)")
        }
    }

    // MARK: Meta

    public func health() async throws -> HealthResponse { try await request(.GET, "/api/health") }
    public func config() async throws -> ServerConfig { try await request(.GET, "/api/config") }
    public func variables() async throws -> [WeatherVariable] {
        let r: VariablesResponse = try await request(.GET, "/api/variables")
        return r.variables
    }
    public func me() async throws -> APIUser? {
        let r: MeResponse = try await request(.GET, "/api/me")
        return r.user
    }
    /// Local development only (404 elsewhere): e-mails the API would have sent.
    public func devOutbox(to: String? = nil) async throws -> [DevOutboxMessage] {
        let query = to.map { [URLQueryItem(name: "to", value: $0)] } ?? []
        let r: DevOutboxResponse = try await request(.GET, "/api/dev/outbox", query: query)
        return r.messages
    }

    // MARK: Places and forecast

    public func searchPlaces(_ query: String, count: Int = 8) async throws -> [PlaceSearchResult] {
        let r: PlacesSearchResponse = try await request(.GET, "/api/places/search", query: [
            URLQueryItem(name: "q", value: query), URLQueryItem(name: "count", value: String(count)),
        ])
        return r.results
    }

    public func forecast(latitude: Double, longitude: Double, timezone: String? = nil) async throws -> Forecast {
        var query = [URLQueryItem(name: "latitude", value: String(latitude)), URLQueryItem(name: "longitude", value: String(longitude))]
        if let timezone, !timezone.isEmpty { query.append(URLQueryItem(name: "timezone", value: timezone)) }
        return try await request(.GET, "/api/forecast", query: query)
    }

    // MARK: Rules

    private func rulePath(_ id: String, _ suffix: String = "") -> String {
        "/api/rules/" + (id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id) + suffix
    }

    public func listRules() async throws -> [Rule] {
        let r: RulesListResponse = try await request(.GET, "/api/rules")
        return r.rules
    }
    public func getRule(_ id: String) async throws -> Rule {
        let r: RuleResponse = try await request(.GET, rulePath(id))
        return r.rule
    }
    public func createRule(_ definition: RuleDefinition) async throws -> Rule {
        let r: RuleResponse = try await request(.POST, "/api/rules", body: definition)
        return r.rule
    }
    public func updateRule(_ id: String, _ definition: RuleDefinition) async throws -> Rule {
        let r: RuleResponse = try await request(.PUT, rulePath(id), body: definition)
        return r.rule
    }
    public func deleteRule(_ id: String) async throws {
        _ = try await send(.DELETE, rulePath(id))
    }
    public func pauseRule(_ id: String) async throws -> Rule {
        let r: RuleResponse = try await request(.POST, rulePath(id, "/pause"))
        return r.rule
    }
    public func resumeRule(_ id: String) async throws -> Rule {
        let r: RuleResponse = try await request(.POST, rulePath(id, "/resume"))
        return r.rule
    }
    /// Evaluate now and push the result to every device of the account, whatever the trigger state.
    public func testRule(_ id: String) async throws -> RuleTestResponse {
        try await request(.POST, rulePath(id, "/test"))
    }

    // MARK: Push

    public struct NativeRegistration: Encodable, Sendable {
        public var channel: String
        public var token: String
        public var userAgent: String?
    
    public init(channel: String, token: String, userAgent: String? = nil) {
        self.channel = channel
        self.token = token
        self.userAgent = userAgent
    }
}

    public func listPushSubscriptions() async throws -> [PushSubscriptionInfo] {
        let r: PushListResponse = try await request(.GET, "/api/push/subscriptions")
        return r.subscriptions
    }

    /// Register this device's APNs token (`POST /api/push/devices`; idempotent, the server upserts by token).
    public func registerAPNs(token: String, deviceDescription: String? = nil) async throws -> PushDeviceResponse {
        try await request(.POST, "/api/push/devices", body: NativeRegistration(
            channel: "apns", token: token, userAgent: deviceDescription ?? userAgent))
    }

    /// Forget a native device token (`DELETE /api/push/devices`).
    public func unregisterDevice(token: String) async throws {
        struct Body: Encodable { let token: String }
        _ = try await send(.DELETE, "/api/push/devices", body: try encoder.encode(Body(token: token)))
    }

    /// Forget a web push subscription by its endpoint (`DELETE /api/push/subscriptions`).
    public func unregisterWebPush(endpoint: String) async throws {
        struct Body: Encodable { let endpoint: String }
        _ = try await send(.DELETE, "/api/push/subscriptions", body: try encoder.encode(Body(endpoint: endpoint)))
    }

    // MARK: Auth (Better Auth at /api/auth/*)

    private func storeToken(from response: Response) {
        if let token = response.headers["set-auth-token"], !token.isEmpty { tokens.save(token) }
    }

    public func signUp(name: String, email: String, password: String, callbackURL: String? = nil) async throws {
        struct Body: Encodable { let name: String; let email: String; let password: String; let callbackURL: String? }
        let data = try encoder.encode(Body(name: name, email: email, password: password, callbackURL: callbackURL))
        let response = try await send(.POST, "/api/auth/sign-up/email", body: data)
        storeToken(from: response)
    }

    /// Throws `APIError` with `isEmailNotVerified` until the verification link was opened.
    @discardableResult
    public func signIn(email: String, password: String) async throws -> APIUser? {
        struct Body: Encodable { let email: String; let password: String }
        let data = try encoder.encode(Body(email: email, password: password))
        let response = try await send(.POST, "/api/auth/sign-in/email", body: data)
        storeToken(from: response)
        let body = try? decoder.decode(SignInResponse.self, from: response.data)
        if tokens.load() == nil, let token = body?.token { tokens.save(token) }
        return body?.user
    }

    public func sendVerificationEmail(email: String, callbackURL: String? = nil) async throws {
        struct Body: Encodable { let email: String; let callbackURL: String? }
        _ = try await send(.POST, "/api/auth/send-verification-email", body: try encoder.encode(Body(email: email, callbackURL: callbackURL)))
    }

    /// Opens a verification link from the dev outbox on the user's behalf. The API verifies and then
    /// redirects to the web app; any 2xx/3xx counts, a redirect target that is not running does not.
    public func openVerificationLink(_ link: URL) async throws {
        var request = URLRequest(url: link)
        request.setValue(userAgent, forHTTPHeaderField: "user-agent")
        #if canImport(FoundationNetworking)
        let (_, response) = try await session.data(for: request)
        #else
        let (_, response) = try await session.data(for: request, delegate: NoRedirect.shared)
        #endif
        guard let http = response as? HTTPURLResponse, (200..<400).contains(http.statusCode) else {
            throw APIError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, code: "verify_failed", message: "The verification link did not work")
        }
    }

    /// Better Auth's browser flow: the URL to open in `ASWebAuthenticationSession`; it ends on `callbackURL`.
    public func socialSignInURL(provider: String = "google", callbackURL: String) async throws -> URL {
        struct Body: Encodable { let provider: String; let callbackURL: String }
        let r: SocialSignInResponse = try await request(.POST, "/api/auth/sign-in/social", body: Body(provider: provider, callbackURL: callbackURL))
        guard let s = r.url, let url = URL(string: s) else { throw APIError(status: 0, code: "no_url", message: "The server returned no sign-in URL") }
        return url
    }

    /// `GET /api/native/handoff?redirect=<app scheme>://auth/callback`: where the browser flow should end.
    public func nativeHandoffURL(redirect: String) -> URL {
        url("/api/native/handoff", query: [URLQueryItem(name: "redirect", value: redirect)])
    }

    /// Exchanges the one-time token from the hand-off redirect for a bearer session.
    public func verifyOneTimeToken(_ token: String) async throws {
        struct Body: Encodable { let token: String }
        let response = try await send(.POST, "/api/auth/one-time-token/verify", body: try encoder.encode(Body(token: token)))
        storeToken(from: response)
        if tokens.load() == nil { throw APIError(status: 0, code: "no_token", message: "The server did not return a session token") }
    }

    public func signOut() async {
        _ = try? await send(.POST, "/api/auth/sign-out")
        tokens.clear()
        session.configuration.httpCookieStorage?.removeCookies(since: .distantPast)
    }
}

/// Stops URLSession from following the verification link's redirect to the web app.
final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    static let shared = NoRedirect()

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

#if canImport(FoundationNetworking)
// swift-corelibs-foundation (Linux) has no async URLSession API yet; the same shape on top of dataTask.
extension URLSession {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            let task = dataTask(with: request) { data, response, error in
                if let error { continuation.resume(throwing: error) }
                else if let data, let response { continuation.resume(returning: (data, response)) }
                else { continuation.resume(throwing: URLError(.badServerResponse)) }
            }
            task.resume()
        }
    }
}
#endif
