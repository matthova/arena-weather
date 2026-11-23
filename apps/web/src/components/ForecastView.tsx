import type { Forecast } from "@arena-weather/core";
import {
  dailyValue,
  describeWeatherCode,
  formatCompass,
  formatDay,
  formatHour,
  formatNumber,
  formatTemp,
  formatTime,
  hourlyValue,
  upcomingHours,
} from "~/lib/format";

export function ForecastView({
  forecast,
  placeLabel,
  now = Date.now(),
}: {
  forecast: Forecast;
  placeLabel: string;
  now?: number;
}) {
  const tz = forecast.timezone;
  const unit = (v: string, fallback: string) => forecast.units[v] ?? fallback;
  const cur = forecast.current;
  const curCode = describeWeatherCode(cur?.values.weather_code, (cur?.values.is_day ?? 1) === 1);
  const hours = upcomingHours(forecast, 24, now / 1000);

  return (
    <div className="stack" data-testid="forecast">
      <section className="card current" aria-label="Current conditions">
        <div>
          <h2 style={{ marginBottom: 0 }}>{placeLabel}</h2>
          <div className="muted small">
            {cur
              ? `${curCode.text} · updated ${formatTime(cur.time, tz)}`
              : "Current conditions unavailable"}
          </div>
          <div className="row" style={{ marginTop: "0.5rem" }}>
            <span className="icon" aria-hidden="true">
              {curCode.icon}
            </span>
            <span className="temp" data-testid="current-temp">
              {formatTemp(cur?.values.temperature_2m, unit("temperature_2m", "°C"))}
            </span>
          </div>
        </div>
        <dl>
          <div>
            <dt>Feels like</dt>
            <dd>
              {formatTemp(cur?.values.apparent_temperature, unit("apparent_temperature", "°C"))}
            </dd>
          </div>
          <div>
            <dt>Humidity</dt>
            <dd>{formatNumber(cur?.values.relative_humidity_2m, "%")}</dd>
          </div>
          <div>
            <dt>Wind</dt>
            <dd>
              {formatNumber(cur?.values.wind_speed_10m, unit("wind_speed_10m", "km/h"))}{" "}
              {formatCompass(cur?.values.wind_direction_10m)}
            </dd>
          </div>
          <div>
            <dt>Gusts</dt>
            <dd>{formatNumber(cur?.values.wind_gusts_10m, unit("wind_gusts_10m", "km/h"))}</dd>
          </div>
          <div>
            <dt>Precipitation</dt>
            <dd>{formatNumber(cur?.values.precipitation, unit("precipitation", "mm"), 1)}</dd>
          </div>
          <div>
            <dt>Cloud cover</dt>
            <dd>{formatNumber(cur?.values.cloud_cover, "%")}</dd>
          </div>
        </dl>
      </section>

      <section className="card" aria-label="Next 24 hours">
        <h2>Next 24 hours</h2>
        <div className="hourly" data-testid="hourly">
          {hours.map((i) => {
            const t = forecast.hourly.time[i] ?? 0;
            const code = describeWeatherCode(
              hourlyValue(forecast, "weather_code", i),
              (hourlyValue(forecast, "is_day", i) ?? 1) === 1,
            );
            const p = hourlyValue(forecast, "precipitation_probability", i);
            return (
              <div className="hour" key={t} title={code.text}>
                <div className="t">{formatHour(t, tz)}</div>
                <div className="i" aria-hidden="true">
                  {code.icon}
                </div>
                <div className="v">{formatTemp(hourlyValue(forecast, "temperature_2m", i))}</div>
                <div className="p">{p !== null && p > 0 ? `${Math.round(p)}%` : ""}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card" aria-label="7-day forecast">
        <h2>7 days</h2>
        <div className="daily" data-testid="daily">
          {forecast.daily.time.slice(0, 7).map((t, i) => {
            const code = describeWeatherCode(dailyValue(forecast, "weather_code", i));
            const p = dailyValue(forecast, "precipitation_probability_max", i);
            const sum = dailyValue(forecast, "precipitation_sum", i);
            return (
              <div className="day" key={t}>
                <strong>{formatDay(t, tz, now)}</strong>
                <span aria-hidden="true" style={{ fontSize: "1.3rem" }}>
                  {code.icon}
                </span>
                <span className="desc">
                  {code.text}
                  {p !== null && p > 0 ? ` · ${Math.round(p)}%` : ""}
                  {sum !== null && sum > 0 ? ` · ${formatNumber(sum, "mm", 1)}` : ""}
                </span>
                <span className="range">
                  <span className="hi">
                    {formatTemp(dailyValue(forecast, "temperature_2m_max", i))}
                  </span>
                  <span className="lo">
                    {formatTemp(dailyValue(forecast, "temperature_2m_min", i))}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <p className="muted small">
        Weather data by <a href="https://open-meteo.com/">Open-Meteo</a> · times in {tz}
      </p>
    </div>
  );
}
