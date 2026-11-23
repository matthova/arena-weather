import UIKit
import UserNotifications
import WeatherAlertsKit

/// iOS push stack: permission via UserNotifications, the token via `registerForRemoteNotifications`.
@MainActor
final class APNsRegistrar: PushRegistrar {
    /// Debug builds run against the APNs sandbox; TestFlight/App Store builds against production.
    /// (The API picks the APNs host per token from this value.)
    var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    var deviceDescription: String {
        let device = UIDevice.current
        var systemInfo = utsname()
        uname(&systemInfo)
        let machine = withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(validatingUTF8: $0) ?? "iPhone" }
        }
        return "\(device.name) · \(machine) · \(device.systemName) \(device.systemVersion)"
    }

    func authorizationStatus() async -> PushAuthorization {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral: return .authorized
        case .denied: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }

    func requestAndRegister() async throws -> String {
        let center = UNUserNotificationCenter.current()
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        guard granted else { throw PushError.denied }
        return try await PushTokenRelay.shared.nextToken {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func registerIfAuthorized() async throws -> String? {
        guard await authorizationStatus() == .authorized else { return nil }
        return try await PushTokenRelay.shared.nextToken(timeout: .seconds(10)) {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }
}
