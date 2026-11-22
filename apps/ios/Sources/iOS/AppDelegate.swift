import UIKit
import UserNotifications
import WeatherAlertsKit

/// APNs token callbacks and notification taps. Everything else is SwiftUI.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    weak var model: AppModel?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushTokenRelay.shared.deliver(.success(PushTokenRelay.hex(deviceToken)))
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushTokenRelay.shared.deliver(.failure(PushError.failed(error.localizedDescription)))
    }

    // Show alerts while the app is in the foreground too.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    // A tap opens the rule the notification is about (`data.ruleId` in the payload, same as the web push).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let data = info["data"] as? [String: Any]
        guard let ruleID = (data?["ruleId"] as? String) ?? (info["ruleId"] as? String) else { return }
        await MainActor.run { model?.pendingRuleID = ruleID }
    }
}
