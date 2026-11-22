import CoreLocation
import Foundation
import WeatherAlertsKit

enum LocationError: LocalizedError {
    case denied
    case unavailable

    var errorDescription: String? {
        switch self {
        case .denied: return "Location access is off for this app. Allow it in Settings, or search for a place."
        case .unavailable: return "Your location could not be determined."
        }
    }
}

/// One-shot "where am I" with CoreLocation, turned into a `Place` (reverse geocoded label + timezone).
/// Works on iOS and macOS (CoreLocation is on both).
@MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var authorizationWaiter: CheckedContinuation<CLAuthorizationStatus, Never>?
    private var locationWaiter: CheckedContinuation<CLLocation, Error>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func currentPlace() async throws -> Place {
        var status = manager.authorizationStatus
        if status == .notDetermined {
            status = await withCheckedContinuation { continuation in
                authorizationWaiter = continuation
                manager.requestWhenInUseAuthorization()
            }
        }
        #if os(macOS)
        let allowed: [CLAuthorizationStatus] = [.authorizedAlways, .authorized]
        #else
        let allowed: [CLAuthorizationStatus] = [.authorizedAlways, .authorizedWhenInUse]
        #endif
        guard allowed.contains(status) else { throw LocationError.denied }

        let location = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<CLLocation, Error>) in
            locationWaiter = continuation
            manager.requestLocation()
        }
        let coordinate = location.coordinate
        var label = String(format: "%.2f, %.2f", coordinate.latitude, coordinate.longitude)
        var timezone: String? = TimeZone.current.identifier
        if let placemark = try? await CLGeocoder().reverseGeocodeLocation(location).first {
            let parts = [placemark.locality ?? placemark.subAdministrativeArea ?? placemark.name, placemark.administrativeArea, placemark.country]
            let named = parts.compactMap { $0 }.filter { !$0.isEmpty }
            if !named.isEmpty { label = named.joined(separator: ", ") }
            if let tz = placemark.timeZone?.identifier { timezone = tz }
        }
        return Place(label: label, latitude: coordinate.latitude, longitude: coordinate.longitude, timezone: timezone)
    }

    // MARK: CLLocationManagerDelegate (CoreLocation calls these on the main thread for this manager)

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            guard status != .notDetermined, let waiter = authorizationWaiter else { return }
            authorizationWaiter = nil
            waiter.resume(returning: status)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let last = locations.last
        Task { @MainActor in
            guard let waiter = locationWaiter else { return }
            locationWaiter = nil
            if let last { waiter.resume(returning: last) } else { waiter.resume(throwing: LocationError.unavailable) }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            guard let waiter = locationWaiter else { return }
            locationWaiter = nil
            waiter.resume(throwing: error)
        }
    }
}
