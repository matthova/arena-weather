package com.arenaweather.app.data.weather

import com.arenaweather.app.data.api.Forecast
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/** WMO weather interpretation codes -> short description + emoji (same table as the web app). */
data class WeatherDescription(val text: String, val icon: String)

private data class Code(val text: String, val icon: String, val night: String? = null)

private val WEATHER_CODES: Map<Int, Code> = mapOf(
    0 to Code("Clear sky", "☀️", "🌙"),
    1 to Code("Mainly clear", "🌤️", "🌙"),
    2 to Code("Partly cloudy", "⛅", "☁️"),
    3 to Code("Overcast", "☁️"),
    45 to Code("Fog", "🌫️"),
    48 to Code("Rime fog", "🌫️"),
    51 to Code("Light drizzle", "🌦️"),
    53 to Code("Drizzle", "🌦️"),
    55 to Code("Dense drizzle", "🌧️"),
    56 to Code("Freezing drizzle", "🌧️"),
    57 to Code("Freezing drizzle", "🌧️"),
    61 to Code("Light rain", "🌦️"),
    63 to Code("Rain", "🌧️"),
    65 to Code("Heavy rain", "🌧️"),
    66 to Code("Freezing rain", "🌧️"),
    67 to Code("Freezing rain", "🌧️"),
    71 to Code("Light snow", "🌨️"),
    73 to Code("Snow", "🌨️"),
    75 to Code("Heavy snow", "❄️"),
    77 to Code("Snow grains", "❄️"),
    80 to Code("Rain showers", "🌦️"),
    81 to Code("Rain showers", "🌧️"),
    82 to Code("Violent showers", "⛈️"),
    85 to Code("Snow showers", "🌨️"),
    86 to Code("Snow showers", "🌨️"),
    95 to Code("Thunderstorm", "⛈️"),
    96 to Code("Thunderstorm, hail", "⛈️"),
    99 to Code("Thunderstorm, hail", "⛈️"),
)

fun describeWeatherCode(code: Double?, isDay: Boolean = true): WeatherDescription {
    if (code == null) return WeatherDescription("–", "")
    val c = WEATHER_CODES[code.roundToInt()] ?: return WeatherDescription("Code ${code.roundToInt()}", "🌡️")
    return WeatherDescription(c.text, if (!isDay && c.night != null) c.night else c.icon)
}

fun formatTemp(v: Double?, unit: String = "°"): String = if (v == null) "–" else "${v.roundToInt()}$unit"

fun formatNumber(v: Double?, unit: String = "", digits: Int = 0): String {
    if (v == null) return "–"
    val s = if (digits == 0) v.roundToInt().toString() else String.format(Locale.US, "%.${digits}f", v)
    return if (unit.isEmpty()) s else "$s $unit"
}

fun formatCompass(deg: Double?): String {
    if (deg == null) return "–"
    val dirs = listOf("N", "NE", "E", "SE", "S", "SW", "W", "NW")
    return dirs[((deg / 45.0).roundToInt() % 8 + 8) % 8]
}

private fun zoned(unix: Long, timeZone: String): ZonedDateTime =
    Instant.ofEpochSecond(unix).atZone(runCatching { ZoneId.of(timeZone) }.getOrDefault(ZoneId.systemDefault()))

fun formatHour(unix: Long, timeZone: String): String = zoned(unix, timeZone).format(DateTimeFormatter.ofPattern("HH"))

fun formatDay(unix: Long, timeZone: String, now: Long = System.currentTimeMillis() / 1000): String {
    val z = zoned(unix, timeZone)
    val today = zoned(now, timeZone).toLocalDate()
    return when (z.toLocalDate()) {
        today -> "Today"
        today.plusDays(1) -> "Tomorrow"
        else -> z.format(DateTimeFormatter.ofPattern("EEE d MMM"))
    }
}

fun formatDateTime(unix: Long, timeZone: String): String =
    zoned(unix, timeZone).format(DateTimeFormatter.ofPattern("EEE d MMM, HH:mm"))

/** Indices of the hourly samples from the current hour on, at most [hours] of them. */
fun Forecast.upcomingHourIndices(hours: Int = 24, now: Long = System.currentTimeMillis() / 1000): List<Int> {
    val start = hourly.time.indexOfFirst { it + 3600 > now }.let { if (it < 0) 0 else it }
    return (start until minOf(hourly.time.size, start + hours)).toList()
}
