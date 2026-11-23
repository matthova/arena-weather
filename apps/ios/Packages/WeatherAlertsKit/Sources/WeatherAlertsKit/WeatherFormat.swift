import Foundation

/// Presentation helpers shared by the forecast screens (mirrors apps/web/src/lib/format.ts).
public enum WeatherFormat {
    public struct CodeDescription: Hashable, Sendable {
        public let text: String
        public let symbol: String
    
    public init(text: String, symbol: String) {
        self.text = text
        self.symbol = symbol
    }
}

    /// WMO weather interpretation code → text + SF Symbol name.
    public static func describe(code: Double?, isDay: Bool = true) -> CodeDescription {
        guard let code else { return CodeDescription(text: "–", symbol: "questionmark") }
        let day = isDay
        switch Int(code) {
        case 0: return .init(text: "Clear sky", symbol: day ? "sun.max" : "moon.stars")
        case 1: return .init(text: "Mainly clear", symbol: day ? "sun.min" : "moon")
        case 2: return .init(text: "Partly cloudy", symbol: day ? "cloud.sun" : "cloud.moon")
        case 3: return .init(text: "Overcast", symbol: "cloud")
        case 45, 48: return .init(text: "Fog", symbol: "cloud.fog")
        case 51, 53: return .init(text: "Drizzle", symbol: "cloud.drizzle")
        case 55, 56, 57: return .init(text: "Dense drizzle", symbol: "cloud.drizzle.fill")
        case 61: return .init(text: "Light rain", symbol: "cloud.rain")
        case 63: return .init(text: "Rain", symbol: "cloud.rain.fill")
        case 65: return .init(text: "Heavy rain", symbol: "cloud.heavyrain.fill")
        case 66, 67: return .init(text: "Freezing rain", symbol: "cloud.sleet")
        case 71: return .init(text: "Light snow", symbol: "cloud.snow")
        case 73: return .init(text: "Snow", symbol: "cloud.snow.fill")
        case 75, 77: return .init(text: "Heavy snow", symbol: "snowflake")
        case 80, 81: return .init(text: "Rain showers", symbol: "cloud.sun.rain")
        case 82: return .init(text: "Violent showers", symbol: "cloud.bolt.rain")
        case 85, 86: return .init(text: "Snow showers", symbol: "cloud.snow")
        case 95: return .init(text: "Thunderstorm", symbol: "cloud.bolt")
        case 96, 99: return .init(text: "Thunderstorm, hail", symbol: "cloud.bolt.rain.fill")
        case let other: return .init(text: "Code \(other)", symbol: "thermometer.medium")
        }
    }

    public static func temperature(_ value: Double?, unit: String = "°") -> String {
        guard let value, value.isFinite else { return "–" }
        return "\(Int(value.rounded()))\(unit)"
    }

    public static func number(_ value: Double?, unit: String = "", digits: Int = 0) -> String {
        guard let value, value.isFinite else { return "–" }
        let text = digits == 0 ? String(Int(value.rounded())) : String(format: "%.\(digits)f", value)
        return unit.isEmpty ? text : "\(text) \(unit)"
    }

    public static func compass(_ degrees: Double?) -> String {
        guard let degrees else { return "–" }
        let dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        return dirs[Int((degrees / 45).rounded()) % 8]
    }

    private static func formatter(_ timeZone: TimeZone, _ configure: (DateFormatter) -> Void) -> DateFormatter {
        let f = DateFormatter()
        f.locale = .autoupdatingCurrent
        f.timeZone = timeZone
        configure(f)
        return f
    }

    /// "14:00" / "2:00 PM" in the place's timezone.
    public static func time(_ unix: Int, timeZone: TimeZone) -> String {
        formatter(timeZone) { $0.setLocalizedDateFormatFromTemplate("jmm") }.string(from: Date(timeIntervalSince1970: TimeInterval(unix)))
    }

    /// "14" / "2 PM": the short form for the hourly strip.
    public static func hour(_ unix: Int, timeZone: TimeZone) -> String {
        formatter(timeZone) { $0.setLocalizedDateFormatFromTemplate("j") }.string(from: Date(timeIntervalSince1970: TimeInterval(unix)))
    }

    /// "Today", else "Mon 3".
    public static func day(_ unix: Int, timeZone: TimeZone, now: Date = Date()) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(unix))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        if calendar.isDate(date, inSameDayAs: now) { return "Today" }
        return formatter(timeZone) { $0.setLocalizedDateFormatFromTemplate("EEE d") }.string(from: date)
    }

    public static func dateTime(_ unix: Int, timeZone: TimeZone) -> String {
        formatter(timeZone) { $0.setLocalizedDateFormatFromTemplate("EEE jmm") }.string(from: Date(timeIntervalSince1970: TimeInterval(unix)))
    }

    /// ISO-8601 server timestamps ("2024-05-01T12:00:00.000Z") → a short relative/local string.
    public static func isoDate(_ iso: String?) -> String? {
        guard let iso else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? { () -> Date? in
            parser.formatOptions = [.withInternetDateTime]
            return parser.date(from: iso)
        }()
        guard let date else { return iso }
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: date)
    }
}
