import Foundation

/// What the shared UI needs from a platform's push stack (APNs on iOS now, macOS in slice 3).
public enum PushAuthorization: Equatable, Sendable {
    case notDetermined
    case denied
    case authorized
}

public enum PushError: LocalizedError, Equatable {
    case denied
    case timedOut
    case unavailable(String)
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .denied: return "Notifications are turned off for this app. Enable them in Settings."
        case .timedOut: return "No device token arrived from APNs (the simulator usually cannot register; try a device)."
        case .unavailable(let why): return why
        case .failed(let why): return why
        }
    }
}

@MainActor
public protocol PushRegistrar: AnyObject {
    /// "sandbox" for Xcode/debug builds, "production" for TestFlight/App Store (what the API tells APNs).
    var environment: String { get }
    /// Shown in the devices list, e.g. "iPhone15,3 · iOS 17.5".
    var deviceDescription: String { get }
    func authorizationStatus() async -> PushAuthorization
    /// Asks for permission when needed and registers with APNs; the hex device token.
    func requestAndRegister() async throws -> String
    /// Re-registers silently when the user already allowed notifications (tokens can rotate); nil otherwise.
    func registerIfAuthorized() async throws -> String?
}

/// Previews, tests, and platforms without a push stack yet.
@MainActor
public final class UnavailablePushRegistrar: PushRegistrar {
    public let environment = "sandbox"
    public let deviceDescription = "Preview"
    private let reason: String

    public init(reason: String = "Push notifications are not available here.") { self.reason = reason }

    public func authorizationStatus() async -> PushAuthorization { .notDetermined }
    public func requestAndRegister() async throws -> String { throw PushError.unavailable(reason) }
    public func registerIfAuthorized() async throws -> String? { nil }
}

/// Hands the device token (or failure) from the app delegate to whoever is awaiting it.
@MainActor
public final class PushTokenRelay {
    public static let shared = PushTokenRelay()

    private final class Waiter {
        var continuation: CheckedContinuation<String, Error>?
    }

    public private(set) var lastToken: String?
    public private(set) var lastError: String?
    private var waiters: [Waiter] = []

    public func deliver(_ result: Result<String, Error>) {
        switch result {
        case .success(let token): lastToken = token; lastError = nil
        case .failure(let error): lastError = error.localizedDescription
        }
        let pending = waiters
        waiters.removeAll()
        for w in pending {
            w.continuation?.resume(with: result)
            w.continuation = nil
        }
    }

    /// Awaits the next token after `trigger` runs (`registerForRemoteNotifications`), with a timeout.
    public func nextToken(timeout: Duration = .seconds(15), trigger: @escaping @MainActor () -> Void) async throws -> String {
        let waiter = Waiter()
        waiters.append(waiter)
        let timer = Task { @MainActor in
            try? await Task.sleep(for: timeout)
            self.fail(waiter, PushError.timedOut)
        }
        defer { timer.cancel() }
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            waiter.continuation = continuation
            trigger()
        }
    }

    private func fail(_ waiter: Waiter, _ error: Error) {
        guard let continuation = waiter.continuation else { return }
        waiter.continuation = nil
        waiters.removeAll { $0 === waiter }
        continuation.resume(throwing: error)
    }

    public static func hex(_ deviceToken: Data) -> String {
        deviceToken.map { String(format: "%02x", $0) }.joined()
    }
}
