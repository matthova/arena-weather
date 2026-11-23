import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/providers/forecast.js";
import { createOpenMeteoProvider, toForecast } from "../src/providers/open-meteo.js";

const forecastBody = {
  latitude: 52.52,
  longitude: 13.42,
  elevation: 38,
  timezone: "Europe/Berlin",
  utc_offset_seconds: 7200,
  current_units: { time: "unixtime", interval: "seconds", temperature_2m: "°C" },
  current: { time: 1717329600, interval: 900, temperature_2m: 21.3 },
  hourly_units: { time: "unixtime", temperature_2m: "°C", precipitation_probability: "%" },
  hourly: {
    time: [1717279200, 1717282800],
    temperature_2m: [15.1, null],
    precipitation_probability: [10, 20],
  },
  daily_units: { time: "unixtime", temperature_2m_max: "°C" },
  daily: { time: [1717279200], temperature_2m_max: [24.0] },
};

function fetchRecorder(handler: (url: URL) => Response) {
  const urls: URL[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { fetch: f, urls };
}

describe("Open-Meteo provider", () => {
  it("maps the forecast response to the shared Forecast shape", () => {
    const f = toForecast(forecastBody);
    expect(f.timezone).toBe("Europe/Berlin");
    expect(f.utcOffsetSeconds).toBe(7200);
    expect(f.units).toEqual({
      temperature_2m: "°C",
      precipitation_probability: "%",
      temperature_2m_max: "°C",
    });
    expect(f.current).toEqual({ time: 1717329600, values: { temperature_2m: 21.3 } });
    expect(f.hourly.time).toEqual([1717279200, 1717282800]);
    expect(f.hourly.values.temperature_2m).toEqual([15.1, null]);
    expect(f.daily.values.temperature_2m_max).toEqual([24]);
  });

  it("builds the request URL (unix time, rounded coordinates, sorted de-duplicated variables)", async () => {
    const { fetch, urls } = fetchRecorder(() => Response.json(forecastBody));
    const p = createOpenMeteoProvider({
      forecastUrl: "https://om.test/v1/forecast",
      geocodingUrl: "https://geo.test/v1/search",
      fetch,
      cache: null,
    });
    await p.forecast({
      latitude: 52.5244,
      longitude: 13.4105,
      hourly: ["temperature_2m", "rain", "temperature_2m"],
      daily: [],
      current: ["temperature_2m"],
      forecastDays: 8,
    });
    const u = urls[0] as URL;
    expect(u.origin + u.pathname).toBe("https://om.test/v1/forecast");
    expect(u.searchParams.get("latitude")).toBe("52.52");
    expect(u.searchParams.get("longitude")).toBe("13.41");
    expect(u.searchParams.get("timeformat")).toBe("unixtime");
    expect(u.searchParams.get("timezone")).toBe("auto");
    expect(u.searchParams.get("hourly")).toBe("rain,temperature_2m");
    expect(u.searchParams.get("current")).toBe("temperature_2m");
    expect(u.searchParams.has("daily")).toBe(false);
    expect(u.searchParams.get("forecast_days")).toBe("8");
  });

  it("serves repeated requests from the Cache API within the TTL", async () => {
    const { fetch, urls } = fetchRecorder(() => Response.json(forecastBody));
    const p = createOpenMeteoProvider({
      forecastUrl: "https://om.test/v1/forecast",
      geocodingUrl: "https://geo.test/v1/search",
      fetch,
    });
    const req = { latitude: 1, longitude: 2, hourly: ["rain"], daily: [] };
    await p.forecast(req);
    await p.forecast(req);
    await p.forecast({ ...req, latitude: 1.004 }); // rounds to the same cell
    expect(urls).toHaveLength(1);
    await p.forecast({ ...req, latitude: 3 });
    expect(urls).toHaveLength(2);
  });

  it("maps geocoding results and skips queries shorter than 2 chars", async () => {
    const { fetch, urls } = fetchRecorder(() =>
      Response.json({
        results: [
          {
            id: 1,
            name: "Berlin",
            latitude: 52.5,
            longitude: 13.4,
            country: "Germany",
            country_code: "DE",
            admin1: "Berlin",
            timezone: "Europe/Berlin",
            population: 3_000_000,
          },
        ],
      }),
    );
    const p = createOpenMeteoProvider({
      forecastUrl: "https://om.test/v1/forecast",
      geocodingUrl: "https://geo.test/v1/search",
      fetch,
      cache: null,
    });
    expect(await p.geocode({ query: "B" })).toEqual([]);
    const r = await p.geocode({ query: "Berlin", count: 5 });
    expect(r[0]).toMatchObject({
      label: "Berlin, Berlin, Germany",
      countryCode: "DE",
      timezone: "Europe/Berlin",
    });
    expect(urls[0]?.searchParams.get("count")).toBe("5");
    expect(urls[0]?.searchParams.get("name")).toBe("Berlin");
  });

  it("turns upstream errors into ProviderError", async () => {
    const { fetch } = fetchRecorder(() =>
      Response.json({ error: true, reason: "Latitude must be in range" }, { status: 400 }),
    );
    const p = createOpenMeteoProvider({
      forecastUrl: "https://om.test/v1/forecast",
      geocodingUrl: "https://geo.test/v1/search",
      fetch,
      cache: null,
    });
    await expect(
      p.forecast({ latitude: 1, longitude: 2, hourly: [], daily: [] }),
    ).rejects.toBeInstanceOf(ProviderError);
    await expect(p.forecast({ latitude: 1, longitude: 2, hourly: [], daily: [] })).rejects.toThrow(
      /Latitude must be in range/,
    );
  });
});
