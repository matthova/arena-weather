/**
 * Forecast data as the API serves it and the evaluator consumes it.
 * Times are unix seconds (UTC); `utcOffsetSeconds` lets clients and the evaluator derive local time.
 */
export interface ForecastSeries {
  /** Unix seconds, ascending. Hourly: start of each hour. Daily: local midnight of each day. */
  time: number[];
  /** Variable name -> values aligned with `time`. `null` = no data for that sample. */
  values: Record<string, (number | null)[]>;
}

export interface CurrentConditions {
  time: number;
  values: Record<string, number | null>;
}

export interface Forecast {
  latitude: number;
  longitude: number;
  elevation?: number;
  /** IANA timezone resolved for the place, e.g. "Europe/Berlin". */
  timezone: string;
  utcOffsetSeconds: number;
  /** Variable name -> unit (e.g. temperature_2m -> "°C"). */
  units: Record<string, string>;
  current?: CurrentConditions;
  hourly: ForecastSeries;
  daily: ForecastSeries;
  /** When the provider fetched it (unix seconds). */
  fetchedAt?: number;
}

export interface PlaceSearchResult {
  id: number;
  name: string;
  /** "City, Region, Country" for display */
  label: string;
  latitude: number;
  longitude: number;
  country?: string;
  countryCode?: string;
  admin1?: string;
  timezone?: string;
  population?: number;
}
