import type { Forecast } from "@arena-weather/core";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ForecastView } from "./ForecastView";

const HOUR = 3600;
const DAY = 86400;

function fakeForecast(now: number): Forecast {
  const hourStart = now - (now % HOUR);
  const dayStart = now - (now % DAY);
  const hourly = Array.from({ length: 48 }, (_, i) => hourStart - 2 * HOUR + i * HOUR);
  const daily = Array.from({ length: 7 }, (_, i) => dayStart + i * DAY);
  return {
    latitude: 52.52,
    longitude: 13.41,
    timezone: "UTC",
    utcOffsetSeconds: 0,
    units: { temperature_2m: "°C", wind_speed_10m: "km/h" },
    current: {
      time: now,
      values: {
        temperature_2m: 17.6,
        apparent_temperature: 16.1,
        relative_humidity_2m: 71,
        precipitation: 0,
        weather_code: 3,
        cloud_cover: 90,
        wind_speed_10m: 14.2,
        wind_gusts_10m: 30,
        wind_direction_10m: 270,
        is_day: 1,
      },
    },
    hourly: {
      time: hourly,
      values: {
        temperature_2m: hourly.map((_, i) => 10 + i * 0.5),
        precipitation_probability: hourly.map((_, i) => (i % 2 ? 40 : 0)),
        weather_code: hourly.map(() => 61),
        is_day: hourly.map(() => 1),
      },
    },
    daily: {
      time: daily,
      values: {
        temperature_2m_max: daily.map((_, i) => 20 + i),
        temperature_2m_min: daily.map((_, i) => 9 + i),
        weather_code: daily.map(() => 95),
        precipitation_probability_max: daily.map(() => 80),
        precipitation_sum: daily.map(() => 3.4),
      },
    },
  };
}

describe("<ForecastView>", () => {
  const now = 1_700_000_000; // 2023-11-14T22:13:20Z
  const forecast = fakeForecast(now);

  it("shows current conditions, 24 hourly cells from the current hour, and 7 days", () => {
    render(<ForecastView forecast={forecast} placeLabel="Berlin" now={now * 1000} />);
    expect(screen.getByText("Berlin")).toBeTruthy();
    expect(screen.getByTestId("current-temp").textContent).toBe("18°C");
    expect(screen.getByText(/Overcast/)).toBeTruthy();

    const hours = within(screen.getByTestId("hourly")).getAllByText(/^\d+°$/);
    expect(hours).toHaveLength(24);
    // index 2 is the hour containing "now": 10 + 2*0.5 = 11°
    expect(hours[0]?.textContent).toBe("11°");

    const days = screen.getByTestId("daily").querySelectorAll(".day");
    expect(days).toHaveLength(7);
    expect(days[0]?.textContent).toContain("Today");
    expect(days[0]?.textContent).toContain("Thunderstorm");
    expect(days[0]?.textContent).toContain("20°");
    expect(days[0]?.textContent).toContain("9°");
    expect(days[0]?.textContent).toContain("80%");
  });

  it("copes with missing current conditions", () => {
    const { current: _omit, ...rest } = forecast;
    render(<ForecastView forecast={rest} placeLabel="Nowhere" now={now * 1000} />);
    expect(screen.getByText("Current conditions unavailable")).toBeTruthy();
    expect(screen.getByTestId("current-temp").textContent).toBe("–");
  });
});
