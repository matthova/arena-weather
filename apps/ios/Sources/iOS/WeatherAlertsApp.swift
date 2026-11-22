import SwiftUI
import WeatherAlertsKit

@main
struct WeatherAlertsApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel(push: APNsRegistrar(), tokens: KeychainTokenStore())

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .onAppear { appDelegate.model = model }
        }
    }
}
