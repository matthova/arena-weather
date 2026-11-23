import Foundation

public enum Granularity: String, Codable, CaseIterable, Hashable, Sendable {
    case hourly
    case daily

    public var label: String {
        switch self {
        case .hourly: return "Hourly"
        case .daily: return "Daily"
        }
    }
}

/// One Open-Meteo forecast variable a rule may reference. Same list as `packages/core/src/variables.ts`
/// (`GET /api/variables` returns it too; `VariableCatalog` can refresh from there).
public struct WeatherVariable: Codable, Hashable, Identifiable, Sendable {
    public let name: String
    public let label: String
    public let unit: String
    public let granularity: Granularity

    public init(name: String, label: String, unit: String, granularity: Granularity) {
        self.name = name
        self.label = label
        self.unit = unit
        self.granularity = granularity
    }

    public var id: String { "\(granularity.rawValue):\(name)" }

    /// Units that are not real units and should not be printed after a value.
    public var showsUnit: Bool { unit != "code" && unit != "0/1" && unit != "index" }
}

public enum Variables {
    public static let hourly: [WeatherVariable] = [
        .init(name: "temperature_2m", label: "Temperature (2 m)", unit: "°C", granularity: .hourly),
        .init(name: "apparent_temperature", label: "Feels like", unit: "°C", granularity: .hourly),
        .init(name: "relative_humidity_2m", label: "Relative humidity", unit: "%", granularity: .hourly),
        .init(name: "dew_point_2m", label: "Dew point", unit: "°C", granularity: .hourly),
        .init(name: "precipitation_probability", label: "Precipitation chance", unit: "%", granularity: .hourly),
        .init(name: "precipitation", label: "Precipitation", unit: "mm", granularity: .hourly),
        .init(name: "rain", label: "Rain", unit: "mm", granularity: .hourly),
        .init(name: "showers", label: "Showers", unit: "mm", granularity: .hourly),
        .init(name: "snowfall", label: "Snowfall", unit: "cm", granularity: .hourly),
        .init(name: "snow_depth", label: "Snow depth", unit: "m", granularity: .hourly),
        .init(name: "weather_code", label: "Weather code (WMO)", unit: "code", granularity: .hourly),
        .init(name: "cloud_cover", label: "Cloud cover", unit: "%", granularity: .hourly),
        .init(name: "visibility", label: "Visibility", unit: "m", granularity: .hourly),
        .init(name: "wind_speed_10m", label: "Wind speed (10 m)", unit: "km/h", granularity: .hourly),
        .init(name: "wind_gusts_10m", label: "Wind gusts (10 m)", unit: "km/h", granularity: .hourly),
        .init(name: "wind_direction_10m", label: "Wind direction (10 m)", unit: "°", granularity: .hourly),
        .init(name: "uv_index", label: "UV index", unit: "index", granularity: .hourly),
        .init(name: "is_day", label: "Daylight", unit: "0/1", granularity: .hourly),
        .init(name: "surface_pressure", label: "Surface pressure", unit: "hPa", granularity: .hourly),
        .init(name: "freezing_level_height", label: "Freezing level", unit: "m", granularity: .hourly),
    ]

    public static let daily: [WeatherVariable] = [
        .init(name: "temperature_2m_max", label: "Max temperature", unit: "°C", granularity: .daily),
        .init(name: "temperature_2m_min", label: "Min temperature", unit: "°C", granularity: .daily),
        .init(name: "apparent_temperature_max", label: "Max feels like", unit: "°C", granularity: .daily),
        .init(name: "apparent_temperature_min", label: "Min feels like", unit: "°C", granularity: .daily),
        .init(name: "precipitation_sum", label: "Precipitation total", unit: "mm", granularity: .daily),
        .init(name: "rain_sum", label: "Rain total", unit: "mm", granularity: .daily),
        .init(name: "showers_sum", label: "Showers total", unit: "mm", granularity: .daily),
        .init(name: "snowfall_sum", label: "Snowfall total", unit: "cm", granularity: .daily),
        .init(name: "precipitation_hours", label: "Hours with precipitation", unit: "h", granularity: .daily),
        .init(name: "precipitation_probability_max", label: "Max precipitation chance", unit: "%", granularity: .daily),
        .init(name: "weather_code", label: "Weather code (WMO)", unit: "code", granularity: .daily),
        .init(name: "wind_speed_10m_max", label: "Max wind speed", unit: "km/h", granularity: .daily),
        .init(name: "wind_gusts_10m_max", label: "Max wind gusts", unit: "km/h", granularity: .daily),
        .init(name: "uv_index_max", label: "Max UV index", unit: "index", granularity: .daily),
        .init(name: "sunshine_duration", label: "Sunshine duration", unit: "s", granularity: .daily),
        .init(name: "daylight_duration", label: "Daylight duration", unit: "s", granularity: .daily),
    ]

    public static let all: [WeatherVariable] = hourly + daily

    public static func find(_ name: String, _ granularity: Granularity) -> WeatherVariable? {
        (granularity == .hourly ? hourly : daily).first { $0.name == name }
    }

    public static func list(for granularity: Granularity) -> [WeatherVariable] {
        granularity == .hourly ? hourly : daily
    }
}
