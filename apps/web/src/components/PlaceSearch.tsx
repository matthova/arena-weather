import type { Place, PlaceSearchResult } from "@arena-weather/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { api, errorMessage } from "~/lib/api";

export function toPlace(r: PlaceSearchResult): Place {
  return {
    label: r.label,
    latitude: r.latitude,
    longitude: r.longitude,
    ...(r.timezone ? { timezone: r.timezone } : {}),
  };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function PlaceSearch({
  onSelect,
  placeholder = "Search a city or place…",
  initialQuery = "",
}: {
  onSelect: (place: Place) => void;
  placeholder?: string;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(query.trim(), 250);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  const search = useQuery({
    queryKey: ["places", debounced],
    queryFn: () => api.searchPlaces(debounced, { count: 8 }),
    enabled: debounced.length >= 2,
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const results = search.data?.results ?? [];
  const showList = open && debounced.length >= 2;

  return (
    <div className="search" ref={wrap}>
      <input
        className="input"
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-label="Search a place"
        placeholder={placeholder}
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) {
            e.preventDefault();
            onSelect(toPlace(results[0]));
            setQuery(results[0].label);
            setOpen(false);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {showList && (
        <ul className="search-results" id={listId}>
          {search.isPending && (
            <li className="muted small" style={{ padding: "0.5rem 0.65rem" }}>
              <span className="spinner" /> Searching…
            </li>
          )}
          {search.isError && (
            <li className="error small" style={{ padding: "0.5rem 0.65rem" }}>
              {errorMessage(search.error)}
            </li>
          )}
          {search.isSuccess && results.length === 0 && (
            <li className="muted small" style={{ padding: "0.5rem 0.65rem" }}>
              No places found
            </li>
          )}
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(toPlace(r));
                  setQuery(r.label);
                  setOpen(false);
                }}
              >
                <strong>{r.name}</strong>
                <span className="muted small">
                  {" "}
                  {r.label.startsWith(r.name)
                    ? r.label.slice(r.name.length).replace(/^,\s*/, "")
                    : r.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
