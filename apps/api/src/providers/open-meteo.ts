import type { Forecast, PlaceSearchResult } from "@arena-weather/core";
import {
  type ForecastProvider,
  type ForecastRequest,
  type GeocodeRequest,
  ProviderError,
} from "./forecast.js";

export interface OpenMeteoOptions {
  forecastUrl: string;
  geocodingUrl: string;
  /** Seconds to keep forecast responses in the Cache API. Default 600 (Open-Meteo updates hourly). */
  forecastTtl?: number;
  /** Seconds to keep geocoding responses. Default 86400. */
  geocodeTtl?: number;
  fetch?: typeof fetch;
  /** Cache API storage; defaults to `caches.default` when present, otherwise no caching. */
  cache?: Cache | null;
}

interface OpenMeteoForecastResponse {
  latitude: number;
  longitude: number;
  elevation?: number;
  timezone: string;
  utc_offset_seconds: number;
  current_units?: Record<string, string>;
  current?: Record<string, number | string | null>;
  hourly_units?: Record<string, string>;
  hourly?: Record<string, (number | null)[]>;
  daily_units?: Record<string, string>;
  daily?: Record<string, (number | null)[]>;
  error?: boolean;
  reason?: string;
}

interface OpenMeteoGeocodingResponse {
  results?: {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    country_code?: string;
    admin1?: string;
    timezone?: string;
    population?: number;
  }[];
}

/** Round coordinates so nearby requests share a cache entry (0.01° ≈ 1 km, Open-Meteo's grid is coarser). */
const round = (n: number) => Math.round(n * 100) / 100;

function defaultCache(): Cache | null {
  const c = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return c?.default ?? null;
}

export function createOpenMeteoProvider(options: OpenMeteoOptions): ForecastProvider {
  const fetchImpl = options.fetch ?? fetch;
  const cache = options.cache === undefined ? defaultCache() : options.cache;
  const forecastTtl = options.forecastTtl ?? 600;
  const geocodeTtl = options.geocodeTtl ?? 86400;

  async function cachedJson<T>(url: string, ttl: number): Promise<T> {
    const key = new Request(url, { method: "GET" });
    if (cache) {
      const hit = await cache.match(key);
      if (hit) return (await hit.json()) as T;
    }
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { accept: "application/json" } });
    } catch (e) {
      throw new ProviderError(`Open-Meteo unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let reason = text.slice(0, 200);
      try {
        reason = (JSON.parse(text) as { reason?: string }).reason ?? reason;
      } catch {}
      throw new ProviderError(
        `Open-Meteo error (${res.status}): ${reason}`,
        res.status === 400 ? 400 : 502,
      );
    }
    if (cache) {
      const toStore = new Response(text, {
        headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
      });
      await cache.put(key, toStore);
    }
    return JSON.parse(text) as T;
  }

  return {
    name: "open-meteo",

    async geocode(req: GeocodeRequest): Promise<PlaceSearchResult[]> {
      const q = req.query.trim();
      if (q.length < 2) return [];
      const params = new URLSearchParams({
        name: q,
        count: String(Math.min(Math.max(req.count ?? 10, 1), 50)),
        language: req.language ?? "en",
        format: "json",
      });
      const data = await cachedJson<OpenMeteoGeocodingResponse>(
        `${options.geocodingUrl}?${params}`,
        geocodeTtl,
      );
      return (data.results ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
        latitude: r.latitude,
        longitude: r.longitude,
        country: r.country,
        countryCode: r.country_code,
        admin1: r.admin1,
        timezone: r.timezone,
        population: r.population,
      }));
    },

    async forecast(req: ForecastRequest): Promise<Forecast> {
      const hourly = [...new Set(req.hourly)].sort();
      const daily = [...new Set(req.daily)].sort();
      const current = [...new Set(req.current ?? [])].sort();
      const params = new URLSearchParams({
        latitude: String(round(req.latitude)),
        longitude: String(round(req.longitude)),
        timezone: req.timezone || "auto",
        timeformat: "unixtime",
        forecast_days: String(req.forecastDays ?? 7),
      });
      if (hourly.length) params.set("hourly", hourly.join(","));
      if (daily.length) params.set("daily", daily.join(","));
      if (current.length) params.set("current", current.join(","));
      const data = await cachedJson<OpenMeteoForecastResponse>(
        `${options.forecastUrl}?${params}`,
        forecastTtl,
      );
      if (data.error) throw new ProviderError(data.reason ?? "Open-Meteo error");
      return toForecast(data);
    },
  };
}

export function toForecast(data: OpenMeteoForecastResponse): Forecast {
  const units: Record<string, string> = {};
  for (const u of [data.current_units, data.hourly_units, data.daily_units]) {
    for (const [k, v] of Object.entries(u ?? {}))
      if (k !== "time" && k !== "interval") units[k] = v;
  }
  const series = (block: Record<string, (number | null)[]> | undefined) => {
    const { time = [], ...rest } = block ?? {};
    return { time: time.map((t) => Number(t)), values: rest };
  };
  let current: Forecast["current"];
  if (data.current) {
    const { time, interval: _interval, ...values } = data.current;
    const numeric: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(values)) numeric[k] = v === null ? null : Number(v);
    current = { time: Number(time), values: numeric };
  }
  return {
    latitude: data.latitude,
    longitude: data.longitude,
    elevation: data.elevation,
    timezone: data.timezone,
    utcOffsetSeconds: data.utc_offset_seconds,
    units,
    current,
    hourly: series(data.hourly),
    daily: series(data.daily),
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}
