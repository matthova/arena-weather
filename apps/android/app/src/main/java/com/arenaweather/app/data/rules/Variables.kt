package com.arenaweather.app.data.rules

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** "hourly" or "daily", exactly as the rule JSON spells it. */
@Serializable
enum class Granularity {
    @SerialName("hourly") HOURLY,
    @SerialName("daily") DAILY;

    val wire: String get() = if (this == HOURLY) "hourly" else "daily"
}

/** One forecast variable a rule may reference; same fields as `GET /api/variables` / packages/core variables.ts. */
@Serializable
data class WeatherVariable(
    val name: String,
    val label: String,
    val unit: String,
    val granularity: Granularity,
)

/**
 * The built-in catalogue, a copy of packages/core/src/variables.ts so the builder works offline and
 * before the first request; the app refreshes it from `GET /api/variables` when it can.
 */
object Variables {
    val hourly: List<WeatherVariable> = listOf(
        WeatherVariable("temperature_2m", "Temperature (2 m)", "°C", Granularity.HOURLY),
        WeatherVariable("apparent_temperature", "Feels like", "°C", Granularity.HOURLY),
        WeatherVariable("relative_humidity_2m", "Relative humidity", "%", Granularity.HOURLY),
        WeatherVariable("dew_point_2m", "Dew point", "°C", Granularity.HOURLY),
        WeatherVariable("precipitation_probability", "Precipitation chance", "%", Granularity.HOURLY),
        WeatherVariable("precipitation", "Precipitation", "mm", Granularity.HOURLY),
        WeatherVariable("rain", "Rain", "mm", Granularity.HOURLY),
        WeatherVariable("showers", "Showers", "mm", Granularity.HOURLY),
        WeatherVariable("snowfall", "Snowfall", "cm", Granularity.HOURLY),
        WeatherVariable("snow_depth", "Snow depth", "m", Granularity.HOURLY),
        WeatherVariable("weather_code", "Weather code (WMO)", "code", Granularity.HOURLY),
        WeatherVariable("cloud_cover", "Cloud cover", "%", Granularity.HOURLY),
        WeatherVariable("visibility", "Visibility", "m", Granularity.HOURLY),
        WeatherVariable("wind_speed_10m", "Wind speed (10 m)", "km/h", Granularity.HOURLY),
        WeatherVariable("wind_gusts_10m", "Wind gusts (10 m)", "km/h", Granularity.HOURLY),
        WeatherVariable("wind_direction_10m", "Wind direction (10 m)", "°", Granularity.HOURLY),
        WeatherVariable("uv_index", "UV index", "index", Granularity.HOURLY),
        WeatherVariable("is_day", "Daylight", "0/1", Granularity.HOURLY),
        WeatherVariable("surface_pressure", "Surface pressure", "hPa", Granularity.HOURLY),
        WeatherVariable("freezing_level_height", "Freezing level", "m", Granularity.HOURLY),
    )

    val daily: List<WeatherVariable> = listOf(
        WeatherVariable("temperature_2m_max", "Max temperature", "°C", Granularity.DAILY),
        WeatherVariable("temperature_2m_min", "Min temperature", "°C", Granularity.DAILY),
        WeatherVariable("apparent_temperature_max", "Max feels like", "°C", Granularity.DAILY),
        WeatherVariable("apparent_temperature_min", "Min feels like", "°C", Granularity.DAILY),
        WeatherVariable("precipitation_sum", "Precipitation total", "mm", Granularity.DAILY),
        WeatherVariable("rain_sum", "Rain total", "mm", Granularity.DAILY),
        WeatherVariable("showers_sum", "Showers total", "mm", Granularity.DAILY),
        WeatherVariable("snowfall_sum", "Snowfall total", "cm", Granularity.DAILY),
        WeatherVariable("precipitation_hours", "Hours with precipitation", "h", Granularity.DAILY),
        WeatherVariable("precipitation_probability_max", "Max precipitation chance", "%", Granularity.DAILY),
        WeatherVariable("weather_code", "Weather code (WMO)", "code", Granularity.DAILY),
        WeatherVariable("wind_speed_10m_max", "Max wind speed", "km/h", Granularity.DAILY),
        WeatherVariable("wind_gusts_10m_max", "Max wind gusts", "km/h", Granularity.DAILY),
        WeatherVariable("uv_index_max", "Max UV index", "index", Granularity.DAILY),
        WeatherVariable("sunshine_duration", "Sunshine duration", "s", Granularity.DAILY),
        WeatherVariable("daylight_duration", "Daylight duration", "s", Granularity.DAILY),
    )

    val all: List<WeatherVariable> get() = hourly + daily

    fun forGranularity(g: Granularity): List<WeatherVariable> = if (g == Granularity.HOURLY) hourly else daily

    fun find(name: String, g: Granularity): WeatherVariable? = forGranularity(g).firstOrNull { it.name == name }
}

/** A catalogue that may have been refreshed from the API; falls back to the built-in list. */
class VariableCatalogue(initial: List<WeatherVariable> = Variables.all) {
    @Volatile
    var all: List<WeatherVariable> = initial
        private set

    fun update(fromApi: List<WeatherVariable>) {
        if (fromApi.isNotEmpty()) all = fromApi
    }

    fun forGranularity(g: Granularity): List<WeatherVariable> = all.filter { it.granularity == g }
    fun find(name: String, g: Granularity): WeatherVariable? = forGranularity(g).firstOrNull { it.name == name }
}
