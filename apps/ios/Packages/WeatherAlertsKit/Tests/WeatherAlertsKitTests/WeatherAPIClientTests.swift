import XCTest
@testable import WeatherAlertsKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Records every request and answers from a queue of canned responses.
final class StubProtocol: URLProtocol {
    struct Canned { let status: Int; let body: String; let headers: [String: String] }
    static var queue: [Canned] = []
    static var requests: [URLRequest] = []
    static let lock = NSLock()
    static func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    static func reset() { locked { queue = []; requests = [] } }
    static func enqueue(_ status: Int, _ body: String, headers: [String: String] = [:]) {
        locked { queue.append(Canned(status: status, body: body, headers: headers)) }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var request = self.request
        if let stream = request.httpBodyStream, request.httpBody == nil {
            stream.open()
            var data = Data()
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let n = stream.read(buffer, maxLength: 4096)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
            request.httpBody = data
        }
        let canned = Self.locked { () -> Canned in
            Self.requests.append(request)
            return Self.queue.isEmpty ? Canned(status: 500, body: "{}", headers: [:]) : Self.queue.removeFirst()
        }
        var headers = canned.headers
        headers["content-type"] = "application/json"
        let response = HTTPURLResponse(url: request.url!, statusCode: canned.status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(canned.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class WeatherAPIClientTests: XCTestCase {
    var tokens: InMemoryTokenStore!
    var client: WeatherAPIClient!

    override func setUp() {
        super.setUp()
        StubProtocol.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        tokens = InMemoryTokenStore()
        client = WeatherAPIClient(baseURL: URL(string: "http://localhost:8787")!, tokens: tokens,
                                  userAgent: "WeatherAlertsTests/1.0", session: URLSession(configuration: config))
    }

    private var lastRequest: URLRequest { StubProtocol.locked { StubProtocol.requests.last! } }

    func testBuildsURLsLikeTheCoreClient() {
        XCTAssertEqual(client.url("/api/health").absoluteString, "http://localhost:8787/api/health")
        let withBase = WeatherAPIClient(baseURL: URL(string: "https://example.com/weather/")!, tokens: tokens)
        XCTAssertEqual(withBase.url("/api/rules").absoluteString, "https://example.com/weather/api/rules")
        XCTAssertEqual(client.nativeHandoffURL(redirect: "weatheralerts://auth/callback").absoluteString,
                       "http://localhost:8787/api/native/handoff?redirect=weatheralerts://auth/callback")
    }

    func testForecastQueryAndDecoding() async throws {
        StubProtocol.enqueue(200, #"{"latitude":52.52,"longitude":13.41,"timezone":"Europe/Berlin","utcOffsetSeconds":3600,"units":{},"hourly":{"time":[],"values":{}},"daily":{"time":[],"values":{}}}"#)
        let f = try await client.forecast(latitude: 52.52, longitude: 13.41, timezone: "Europe/Berlin")
        XCTAssertEqual(f.timezone, "Europe/Berlin")
        let url = lastRequest.url!
        XCTAssertEqual(url.path, "/api/forecast")
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertEqual(items.first { $0.name == "latitude" }?.value, "52.52")
        XCTAssertEqual(items.first { $0.name == "timezone" }?.value, "Europe/Berlin")
        XCTAssertEqual(lastRequest.value(forHTTPHeaderField: "accept"), "application/json")
        XCTAssertNil(lastRequest.value(forHTTPHeaderField: "authorization"), "no token yet")
        XCTAssertNil(lastRequest.value(forHTTPHeaderField: "origin"), "GETs carry no origin")
    }

    func testSignInStoresTheBearerTokenAndSendsItAfterwards() async throws {
        StubProtocol.enqueue(200, #"{"redirect":false,"token":"ignored","user":{"id":"u1","email":"a@b.c","name":"Ada","emailVerified":true}}"#,
                             headers: ["set-auth-token": "session-abc"])
        let user = try await client.signIn(email: "a@b.c", password: "pw")
        XCTAssertEqual(user?.email, "a@b.c")
        XCTAssertEqual(tokens.load(), "session-abc")
        XCTAssertTrue(client.isSignedIn)
        XCTAssertEqual(lastRequest.httpMethod, "POST")
        XCTAssertEqual(lastRequest.url?.path, "/api/auth/sign-in/email")
        XCTAssertEqual(lastRequest.value(forHTTPHeaderField: "origin"), "http://localhost:8787")
        XCTAssertEqual(lastRequest.value(forHTTPHeaderField: "content-type"), "application/json")
        let body = try JSONSerialization.jsonObject(with: lastRequest.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?["email"] as? String, "a@b.c")

        StubProtocol.enqueue(200, #"{"rules":[]}"#)
        _ = try await client.listRules()
        XCTAssertEqual(lastRequest.value(forHTTPHeaderField: "authorization"), "Bearer session-abc")
    }

    func testEmailNotVerifiedSurfacesAsATypedError() async {
        StubProtocol.enqueue(403, #"{"code":"EMAIL_NOT_VERIFIED","message":"Email not verified"}"#)
        do {
            try await client.signIn(email: "a@b.c", password: "pw")
            XCTFail("must throw")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 403)
            XCTAssertTrue(error.isEmailNotVerified)
            XCTAssertEqual(error.message, "Email not verified")
        } catch {
            XCTFail("wrong error \(error)")
        }
        XCTAssertNil(tokens.load())
    }

    func testApiErrorsDecodeTheWrappedShape() async {
        StubProtocol.enqueue(400, #"{"error":{"code":"bad_request","message":"Invalid rule","issues":[{"path":["root"]}]}}"#)
        do {
            _ = try await client.createRule(RuleDefinition(name: "x", place: Place(label: "B", latitude: 0, longitude: 0),
                                                           root: ConditionGroup(op: .all, children: [])))
            XCTFail("must throw")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "bad_request")
            XCTAssertEqual(error.message, "Invalid rule")
        } catch {
            XCTFail("wrong error \(error)")
        }
        StubProtocol.enqueue(401, "")
        do {
            _ = try await client.listRules()
            XCTFail("must throw")
        } catch let error as APIError {
            XCTAssertTrue(error.isUnauthorized)
        } catch {
            XCTFail("wrong error \(error)")
        }
    }

    func testRuleRoutesAndBodies() async throws {
        tokens.save("t")
        let def = RuleDefinition(name: "Rain", place: Place(label: "Berlin", latitude: 52.52, longitude: 13.41),
                                 window: TimeWindow(hoursAhead: 12),
                                 root: ConditionGroup(op: .all, children: [.condition(Condition(granularity: .hourly, variable: "rain", comparator: .greaterThan, value: 0.5))]))
        let ruleJSON = #"{"id":"r1","name":"Rain","place":{"label":"Berlin","latitude":52.52,"longitude":13.41},"window":{"hoursAhead":12},"root":{"type":"group","operator":"all","children":[{"type":"condition","granularity":"hourly","variable":"rain","comparator":">","value":0.5,"quantifier":"any"}]},"paused":false,"armed":true,"lastEvaluatedAt":null,"lastFiredAt":null,"createdAt":"c","updatedAt":"u"}"#
        let stored = #"{"rule":"# + ruleJSON + "}"
        StubProtocol.enqueue(201, stored)
        let created = try await client.createRule(def)
        XCTAssertEqual(created.id, "r1")
        XCTAssertEqual(lastRequest.httpMethod, "POST")
        let sent = try JSONSerialization.jsonObject(with: lastRequest.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual((sent?["window"] as? [String: Any])?["hoursAhead"] as? Int, 12)
        XCTAssertEqual(((sent?["root"] as? [String: Any])?["children"] as? [[String: Any]])?.first?["type"] as? String, "condition")

        StubProtocol.enqueue(200, stored)
        _ = try await client.updateRule("r1", def)
        XCTAssertEqual(lastRequest.httpMethod, "PUT")
        XCTAssertEqual(lastRequest.url?.path, "/api/rules/r1")

        StubProtocol.enqueue(200, stored)
        _ = try await client.pauseRule("r1")
        XCTAssertEqual(lastRequest.url?.path, "/api/rules/r1/pause")

        StubProtocol.enqueue(204, "")
        try await client.deleteRule("r1")
        XCTAssertEqual(lastRequest.httpMethod, "DELETE")

        StubProtocol.enqueue(200, #"{"rule":"# + ruleJSON + #","evaluation":{"matched":false,"evaluatedAt":1,"root":{"type":"group","operator":"all","holds":false,"children":[]}},"message":"Rain — conditions not met in Berlin","push":{"attempted":1,"delivered":1,"failed":0}}"#)
        let test = try await client.testRule("r1")
        XCTAssertEqual(lastRequest.url?.path, "/api/rules/r1/test")
        XCTAssertFalse(test.evaluation.matched)
        XCTAssertEqual(test.push.delivered, 1)
    }

    func testPushRegistration() async throws {
        tokens.save("t")
        StubProtocol.enqueue(201, #"{"subscription":{"id":"s1","channel":"apns","endpoint":"abc","environment":"sandbox","createdAt":"c","userAgent":"x"},"deliverable":false}"#)
        let r = try await client.registerAPNs(token: "abc", environment: "sandbox", deviceDescription: "iPhone")
        XCTAssertEqual(r.subscription.channel, "apns")
        XCTAssertEqual(r.deliverable, false)
        let body = try JSONSerialization.jsonObject(with: lastRequest.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?["channel"] as? String, "apns")
        XCTAssertEqual(body?["token"] as? String, "abc")
        XCTAssertEqual(body?["environment"] as? String, "sandbox")
        XCTAssertEqual(body?["userAgent"] as? String, "iPhone")

        StubProtocol.enqueue(204, "")
        try await client.unregisterPush(token: "abc")
        XCTAssertEqual(lastRequest.httpMethod, "DELETE")
        XCTAssertEqual(lastRequest.url?.path, "/api/push/subscriptions")
    }

    func testOneTimeTokenExchangeAndSignOut() async throws {
        StubProtocol.enqueue(200, #"{"user":{"id":"u1","email":"a@b.c","name":"A","emailVerified":true}}"#, headers: ["set-auth-token": "from-google"])
        try await client.verifyOneTimeToken("ott-1")
        XCTAssertEqual(tokens.load(), "from-google")
        let body = try JSONSerialization.jsonObject(with: lastRequest.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?["token"] as? String, "ott-1")

        StubProtocol.enqueue(200, "{}")
        await client.signOut()
        XCTAssertNil(tokens.load())
        XCTAssertEqual(lastRequest.url?.path, "/api/auth/sign-out")
    }

    func testDevOutboxLink() throws {
        let m = DevOutboxMessage(to: "a@b.c", subject: "s", text: "Confirm:\nhttp://localhost:8787/api/auth/verify-email?token=abc&callbackURL=http%3A%2F%2Flocalhost%3A3000\n\nThanks", sentAt: "")
        XCTAssertEqual(m.firstLink?.absoluteString, "http://localhost:8787/api/auth/verify-email?token=abc&callbackURL=http%3A%2F%2Flocalhost%3A3000")
    }
}
