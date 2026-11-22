import Foundation

// Response shapes of the API (packages/core/src/client.ts) that are not rules, forecasts or evaluations.

public struct APIUser: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var email: String
    public var name: String
    public var image: String?
    public var emailVerified: Bool
    public var createdAt: String?
    public var updatedAt: String?

    public init(id: String, email: String, name: String, image: String? = nil, emailVerified: Bool,
                createdAt: String? = nil, updatedAt: String? = nil) {
        self.id = id
        self.email = email
        self.name = name
        self.image = image
        self.emailVerified = emailVerified
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct MeResponse: Codable, Sendable {
    public var user: APIUser?

    public init(user: APIUser? = nil) {
        self.user = user
    }
}

/// `GET /api/config` → `pushChannels`: which native senders the deployment has secrets for.
public struct PushChannels: Codable, Hashable, Sendable {
    public var apns: Bool?
    public var fcm: Bool?

    public init(apns: Bool? = nil, fcm: Bool? = nil) {
        self.apns = apns
        self.fcm = fcm
    }
}

/// `GET /api/config`: what this deployment offers.
public struct ServerConfig: Codable, Hashable, Sendable {
    public var appName: String
    /// Public origin of the web app (e-mail links land there).
    public var appUrl: String?
    public var googleSignIn: Bool
    /// Web push (VAPID) configured.
    public var push: Bool
    /// Absent on an API older than this app: treat as "unknown", not "off".
    public var pushChannels: PushChannels?
    public var devMailbox: Bool

    public init(appName: String, appUrl: String? = nil, googleSignIn: Bool, push: Bool, pushChannels: PushChannels? = nil, devMailbox: Bool) {
        self.appName = appName
        self.appUrl = appUrl
        self.googleSignIn = googleSignIn
        self.push = push
        self.pushChannels = pushChannels
        self.devMailbox = devMailbox
    }

    /// nil = the API predates native push and cannot say.
    public var apnsConfigured: Bool? { pushChannels?.apns }
}

public struct VariablesResponse: Codable, Sendable {
    public var variables: [WeatherVariable]

    public init(variables: [WeatherVariable]) {
        self.variables = variables
    }
}

public struct PlacesSearchResponse: Codable, Sendable {
    public var results: [PlaceSearchResult]

    public init(results: [PlaceSearchResult]) {
        self.results = results
    }
}

public struct RulesListResponse: Codable, Sendable {
    public var rules: [Rule]

    public init(rules: [Rule]) {
        self.rules = rules
    }
}

public struct RuleResponse: Codable, Sendable {
    public var rule: Rule

    public init(rule: Rule) {
        self.rule = rule
    }
}

public struct PushCounts: Codable, Hashable, Sendable {
    public var attempted: Int
    public var delivered: Int
    public var failed: Int

    public init(attempted: Int, delivered: Int, failed: Int) {
        self.attempted = attempted
        self.delivered = delivered
        self.failed = failed
    }
}

public struct RuleTestResponse: Codable, Sendable {
    public var rule: Rule
    public var evaluation: RuleEvaluation
    /// The notification text that was (or would be) sent.
    public var message: String
    public var push: PushCounts

    public init(rule: Rule, evaluation: RuleEvaluation, message: String, push: PushCounts) {
        self.rule = rule
        self.evaluation = evaluation
        self.message = message
        self.push = push
    }
}

/// One row of `GET /api/push/subscriptions`: a browser (webpush) or a device token (apns / fcm).
public struct PushSubscriptionInfo: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    /// "webpush" | "apns" | "fcm" (absent on an older API = webpush).
    public var channel: String?
    /// Web push: the push-service URL. Native: the device token.
    public var endpoint: String
    public var createdAt: String
    public var userAgent: String?

    public var resolvedChannel: String { channel ?? "webpush" }

    public init(id: String, channel: String? = nil, endpoint: String, createdAt: String, userAgent: String? = nil) {
        self.id = id
        self.channel = channel
        self.endpoint = endpoint
        self.createdAt = createdAt
        self.userAgent = userAgent
    }
}

/// `POST /api/push/devices` → `device`.
public struct PushDeviceInfo: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var channel: String
    public var token: String
    public var createdAt: String
    public var userAgent: String?

    public init(id: String, channel: String, token: String, createdAt: String, userAgent: String? = nil) {
        self.id = id
        self.channel = channel
        self.token = token
        self.createdAt = createdAt
        self.userAgent = userAgent
    }
}

public struct PushListResponse: Codable, Sendable {
    public var subscriptions: [PushSubscriptionInfo]

    public init(subscriptions: [PushSubscriptionInfo]) {
        self.subscriptions = subscriptions
    }
}

public struct PushDeviceResponse: Codable, Sendable {
    public var device: PushDeviceInfo
    /// `false` = stored, but the server has no APNs key yet.
    public var deliverable: Bool?

    public init(device: PushDeviceInfo, deliverable: Bool? = nil) {
        self.device = device
        self.deliverable = deliverable
    }
}

public struct DevOutboxMessage: Codable, Hashable, Sendable {
    public var to: String
    public var subject: String
    public var text: String
    public var sentAt: String

    /// The first http(s) link in the text (the verification link).
    public var firstLink: URL? {
        guard let range = text.range(of: #"https?://[^\s]+"#, options: .regularExpression) else { return nil }
        return URL(string: String(text[range]))
    }

    public init(to: String, subject: String, text: String, sentAt: String) {
        self.to = to
        self.subject = subject
        self.text = text
        self.sentAt = sentAt
    }
}

public struct DevOutboxResponse: Codable, Sendable {
    public var messages: [DevOutboxMessage]

    public init(messages: [DevOutboxMessage]) {
        self.messages = messages
    }
}

public struct HealthResponse: Codable, Sendable {
    public var ok: Bool
    public var version: String
    public var time: String

    public init(ok: Bool, version: String, time: String) {
        self.ok = ok
        self.version = version
        self.time = time
    }
}

// Better Auth responses the app reads.

public struct SignInResponse: Codable, Sendable {
    public var redirect: Bool?
    public var token: String?
    public var user: APIUser?

    public init(redirect: Bool? = nil, token: String? = nil, user: APIUser? = nil) {
        self.redirect = redirect
        self.token = token
        self.user = user
    }
}

public struct SocialSignInResponse: Codable, Sendable {
    public var url: String?
    public var redirect: Bool?

    public init(url: String? = nil, redirect: Bool? = nil) {
        self.url = url
        self.redirect = redirect
    }
}

public struct SessionResponse: Codable, Sendable {
    public var user: APIUser?

    public init(user: APIUser? = nil) {
        self.user = user
    }
}
