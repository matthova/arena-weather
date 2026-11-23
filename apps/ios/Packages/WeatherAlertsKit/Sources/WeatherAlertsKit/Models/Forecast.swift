import Foundation

// Forecast data as `GET /api/forecast` serves it (packages/core/src/forecast.ts).

public struct ForecastSeries: Codable, Hashable, Sendable {
    /// Unix seconds, ascending. Hourly: start of each hour. Daily: local midnight.
    public var time: [Int]
    /// Variable name → values aligned with `time`; `nil` = no data for that sample.
    public var values: [String: [Double?]]

    public init(time: [Int], values: [String: [Double?]]) {
        self.time = time
        self.values = values
    }

    public func value(_ variable: String, at index: Int) -> Double? {
        guard let series = values[variable], series.indices.contains(index) else { return nil }
        return series[index]
    }
}

public struct CurrentConditions: Codable, Hashable, Sendable {
    public var time: Int
    public var values: [String: Double?]

    public init(time: Int, values: [String: Double?]) {
        self.time = time
        self.values = values
    }

    public subscript(_ variable: String) -> Double? { values[variable] ?? nil }
}

public struct Forecast: Codable, Hashable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public var elevation: Double?
    /// IANA timezone resolved for the place.
    public var timezone: String
    public var utcOffsetSeconds: Int
    /// Variable name → unit.
    public var units: [String: String]
    public var current: CurrentConditions?
    public var hourly: ForecastSeries
    public var daily: ForecastSeries
    public var fetchedAt: Int?

    public init(latitude: Double, longitude: Double, elevation: Double? = nil, timezone: String, utcOffsetSeconds: Int,
                units: [String: String], current: CurrentConditions? = nil, hourly: ForecastSeries, daily: ForecastSeries,
                fetchedAt: Int? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.elevation = elevation
        self.timezone = timezone
        self.utcOffsetSeconds = utcOffsetSeconds
        self.units = units
        self.current = current
        self.hourly = hourly
        self.daily = daily
        self.fetchedAt = fetchedAt
    }

    public func unit(_ variable: String, fallback: String) -> String { units[variable] ?? fallback }

    public var timeZone: TimeZone {
        TimeZone(identifier: timezone) ?? TimeZone(secondsFromGMT: utcOffsetSeconds) ?? .current
    }

    /// Indices of the next `hours` hourly samples starting at the hour that contains `now`.
    public func upcomingHourIndices(hours: Int = 24, now: Date = Date()) -> [Int] {
        let nowSeconds = Int(now.timeIntervalSince1970)
        var start = hourly.time.firstIndex { $0 + 3600 > nowSeconds } ?? 0
        if start < 0 { start = 0 }
        let count = max(0, min(hours, hourly.time.count - start))
        return Array(start..<(start + count))
    }
}

public struct PlaceSearchResult: Codable, Hashable, Identifiable, Sendable {
    public var id: Int
    public var name: String
    /// "City, Region, Country"
    public var label: String
    public var latitude: Double
    public var longitude: Double
    public var country: String?
    public var countryCode: String?
    public var admin1: String?
    public var timezone: String?
    public var population: Int?

    public init(id: Int, name: String, label: String, latitude: Double, longitude: Double, country: String? = nil,
                countryCode: String? = nil, admin1: String? = nil, timezone: String? = nil, population: Int? = nil) {
        self.id = id
        self.name = name
        self.label = label
        self.latitude = latitude
        self.longitude = longitude
        self.country = country
        self.countryCode = countryCode
        self.admin1 = admin1
        self.timezone = timezone
        self.population = population
    }

    public var place: Place { Place(label: label, latitude: latitude, longitude: longitude, timezone: timezone) }
}
