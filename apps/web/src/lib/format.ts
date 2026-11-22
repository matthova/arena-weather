import type { Forecast } from "@arena-weather/core";

/** WMO weather interpretation codes -> short description + emoji. https://open-meteo.com/en/docs */
const WEATHER_CODES: Record<number, { text: string; icon: string; night?: string }> = {
  0: { text: "Clear sky", icon: "☀️", night: "🌙" },
  1: { text: "Mainly clear", icon: "🌤️", night: "🌙" },
  2: { text: "Partly cloudy", icon: "⛅", night: "☁️" },
  3: { text: "Overcast", icon: "☁️" },
  45: { text: "Fog", icon: "🌫️" },
  48: { text: "Rime fog", icon: "🌫️" },
  51: { text: "Light drizzle", icon: "🌦️" },
  53: { text: "Drizzle", icon: "🌦️" },
  55: { text: "Dense drizzle", icon: "🌧️" },
  56: { text: "Freezing drizzle", icon: "🌧️" },
  57: { text: "Freezing drizzle", icon: "🌧️" },
  61: { text: "Light rain", icon: "🌦️" },
  63: { text: "Rain", icon: "🌧️" },
  65: { text: "Heavy rain", icon: "🌧️" },
  66: { text: "Freezing rain", icon: "🌧️" },
  67: { text: "Freezing rain", icon: "🌧️" },
  71: { text: "Light snow", icon: "🌨️" },
  73: { text: "Snow", icon: "🌨️" },
  75: { text: "Heavy snow", icon: "❄️" },
  77: { text: "Snow grains", icon: "❄️" },
  80: { text: "Rain showers", icon: "🌦️" },
  81: { text: "Rain showers", icon: "🌧️" },
  82: { text: "Violent showers", icon: "⛈️" },
  85: { text: "Snow showers", icon: "🌨️" },
  86: { text: "Snow showers", icon: "🌨️" },
  95: { text: "Thunderstorm", icon: "⛈️" },
  96: { text: "Thunderstorm, hail", icon: "⛈️" },
  99: { text: "Thunderstorm, hail", icon: "⛈️" },
};

export function describeWeatherCode(code: number | null | undefined, isDay = true) {
  if (code === null || code === undefined) return { text: "–", icon: "" };
  const w = WEATHER_CODES[code] ?? { text: `Code ${code}`, icon: "🌡️" };
  return { text: w.text, icon: !isDay && w.night ? w.night : w.icon };
}

export function formatTemp(v: number | null | undefined, unit = "°"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return `${Math.round(v)}${unit}`;
}

export function formatNumber(v: number | null | undefined, unit = "", digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const n = digits === 0 ? Math.round(v) : Number(v.toFixed(digits));
  return `${n}${unit ? ` ${unit}` : ""}`;
}

function fmt(timeZone: string, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone, ...options });
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}

/** "14:00" in the place's timezone. */
export function formatHour(unix: number, timeZone: string): string {
  return fmt(timeZone, { hour: "numeric", minute: "2-digit" }).format(new Date(unix * 1000));
}

/** "Mon", "Tue" … (with "Today" for the current local day). */
export function formatDay(unix: number, timeZone: string, now = Date.now()): string {
  const dayKey = fmt(timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  if (dayKey.format(new Date(unix * 1000)) === dayKey.format(new Date(now))) return "Today";
  return fmt(timeZone, { weekday: "short", day: "numeric" }).format(new Date(unix * 1000));
}

export function formatDateTime(unix: number, timeZone: string): string {
  return fmt(timeZone, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unix * 1000));
}

export function formatCompass(deg: number | null | undefined): string {
  if (deg === null || deg === undefined) return "–";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8] ?? "–";
}

/** The next `hours` hourly samples starting at the hour that contains `now`. */
export function upcomingHours(forecast: Forecast, hours = 24, now = Date.now() / 1000) {
  const { time } = forecast.hourly;
  let start = time.findIndex((t) => t + 3600 > now);
  if (start < 0) start = 0;
  return Array.from({ length: Math.min(hours, time.length - start) }, (_, i) => start + i);
}

export function hourlyValue(forecast: Forecast, variable: string, index: number): number | null {
  return forecast.hourly.values[variable]?.[index] ?? null;
}
export function dailyValue(forecast: Forecast, variable: string, index: number): number | null {
  return forecast.daily.values[variable]?.[index] ?? null;
}
