import type { Forecast, PlaceSearchResult } from "@arena-weather/core";

export interface ForecastRequest {
  latitude: number;
  longitude: number;
  /** IANA timezone or "auto" */
  timezone?: string;
  hourly: string[];
  daily: string[];
  /** Current-conditions variables; empty = none */
  current?: string[];
  forecastDays?: number;
}

export interface GeocodeRequest {
  query: string;
  count?: number;
  language?: string;
}

/** What the rest of the API needs from a weather data source. Open-Meteo is the implementation. */
export interface ForecastProvider {
  readonly name: string;
  geocode(req: GeocodeRequest): Promise<PlaceSearchResult[]>;
  forecast(req: ForecastRequest): Promise<Forecast>;
}

export class ProviderError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

/** Default variables for the forecast endpoint (what the web app shows). */
export const DEFAULT_CURRENT = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "precipitation",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "is_day",
];
export const DEFAULT_HOURLY = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_gusts_10m",
  "uv_index",
  "is_day",
];
export const DEFAULT_DAILY = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "weather_code",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "uv_index_max",
  "sunrise",
  "sunset",
];
