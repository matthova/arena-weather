import Foundation
import WeatherAlertsKit

/// Small persisted preferences (UserDefaults). The session token itself lives in the Keychain.
public struct AppSettings {
    public static let defaultServerURLKey = "WeatherAlertsAPIURL"   // Info.plist
    private static let serverURLKey = "serverURL"
    private static let lastPlaceKey = "lastPlace"
    private static let apnsTokenKey = "apnsRegisteredToken"

    let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    /// The API origin: what the user typed in Account → Server, else Info.plist, else localhost.
    public var serverURL: URL {
        get {
            if let s = defaults.string(forKey: Self.serverURLKey), let url = URL(string: s) { return url }
            if let s = Bundle.main.object(forInfoDictionaryKey: Self.defaultServerURLKey) as? String, let url = URL(string: s), !s.isEmpty { return url }
            return URL(string: "http://localhost:8787")!
        }
        nonmutating set { defaults.set(newValue.absoluteString, forKey: Self.serverURLKey) }
    }

    public var lastPlace: Place? {
        get {
            guard let data = defaults.data(forKey: Self.lastPlaceKey) else { return nil }
            return try? JSONDecoder().decode(Place.self, from: data)
        }
        nonmutating set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) { defaults.set(data, forKey: Self.lastPlaceKey) }
            else { defaults.removeObject(forKey: Self.lastPlaceKey) }
        }
    }

    /// The APNs token we last registered with the API (to unregister it on sign-out).
    public var registeredPushToken: String? {
        get { defaults.string(forKey: Self.apnsTokenKey) }
        nonmutating set {
            if let newValue { defaults.set(newValue, forKey: Self.apnsTokenKey) } else { defaults.removeObject(forKey: Self.apnsTokenKey) }
        }
    }
}
