import type { Place } from "@arena-weather/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ForecastView } from "~/components/ForecastView";
import { PlaceSearch } from "~/components/PlaceSearch";
import { api, errorMessage } from "~/lib/api";

const LAST_PLACE_KEY = "weather-alerts:last-place";

type Search = { lat?: number; lon?: number; name?: string; tz?: string };

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

export const Route = createFileRoute("/")({
  validateSearch: (raw: Record<string, unknown>): Search => ({
    lat: num(raw.lat),
    lon: num(raw.lon),
    name: typeof raw.name === "string" ? raw.name : undefined,
    tz: typeof raw.tz === "string" ? raw.tz : undefined,
  }),
  component: ForecastPage,
});

function placeFromSearch(s: Search): Place | null {
  if (s.lat === undefined || s.lon === undefined) return null;
  return {
    label: s.name ?? `${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`,
    latitude: s.lat,
    longitude: s.lon,
    ...(s.tz ? { timezone: s.tz } : {}),
  };
}

function ForecastPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const place = placeFromSearch(search);

  const select = (p: Place) => {
    localStorage.setItem(LAST_PLACE_KEY, JSON.stringify(p));
    navigate({
      search: { lat: p.latitude, lon: p.longitude, name: p.label, tz: p.timezone },
      replace: false,
    });
  };

  // First visit without a place in the URL: reuse the last one.
  useEffect(() => {
    if (place) return;
    const raw = localStorage.getItem(LAST_PLACE_KEY);
    if (!raw) return;
    try {
      const last = JSON.parse(raw) as Place;
      navigate({
        search: { lat: last.latitude, lon: last.longitude, name: last.label, tz: last.timezone },
        replace: true,
      });
    } catch {
      localStorage.removeItem(LAST_PLACE_KEY);
    }
  }, [place, navigate]);

  const forecast = useQuery({
    queryKey: ["forecast", place?.latitude, place?.longitude, place?.timezone],
    queryFn: () =>
      api.getForecast({
        latitude: place?.latitude ?? 0,
        longitude: place?.longitude ?? 0,
        timezone: place?.timezone,
      }),
    enabled: place !== null,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="stack">
      <PlaceSearch key={place?.label ?? ""} onSelect={select} initialQuery={place?.label ?? ""} />
      {!place && (
        <div className="hero">
          <h1>What's the weather where you care?</h1>
          <p className="muted">
            Search a place to see current conditions, the next 24 hours and the week ahead. Then{" "}
            <Link to="/rules">create a rule</Link> to get a push notification when it matters.
          </p>
        </div>
      )}
      {place && forecast.isPending && (
        <p className="muted">
          <span className="spinner" /> Loading forecast for {place.label}…
        </p>
      )}
      {place && forecast.isError && (
        <div className="notice error">
          Could not load the forecast: {errorMessage(forecast.error)}{" "}
          <button type="button" className="btn sm" onClick={() => forecast.refetch()}>
            Retry
          </button>
        </div>
      )}
      {place && forecast.data && <ForecastView forecast={forecast.data} placeLabel={place.label} />}
      {place && (
        <p className="small">
          <Link
            to="/rules/new"
            search={{
              lat: place.latitude,
              lon: place.longitude,
              name: place.label,
              tz: place.timezone,
            }}
          >
            Create an alert rule for {place.label} →
          </Link>
        </p>
      )}
    </div>
  );
}
