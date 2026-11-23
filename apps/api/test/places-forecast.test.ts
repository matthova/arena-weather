import { describe, expect, it } from "vitest";
import { json, makeWorld } from "./helpers.js";

describe("GET /api/places/search", () => {
  it("returns geocoding results", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/places/search?q=Berlin");
    expect(r.status).toBe(200);
    expect(r.data.results[0].label).toBe("Berlin, Testland");
  });
  it("validates the query", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/places/search");
    expect(r.status).toBe(400);
    expect(r.data.error.code).toBe("bad_request");
  });
});

describe("GET /api/forecast", () => {
  it("returns current + hourly + daily with default variables", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/forecast?latitude=52.52&longitude=13.41");
    expect(r.status).toBe(200);
    expect(r.data.current.values.temperature_2m).toBe(1);
    expect(r.data.hourly.values.precipitation_probability).toHaveLength(24 * 7);
    expect(r.data.daily.values.temperature_2m_max).toHaveLength(7);
    expect(w.provider.calls[0]?.hourly).toContain("temperature_2m");
    expect(w.provider.calls[0]?.daily).toContain("sunrise");
  });
  it("adds requested extra variables and rejects unknown ones", async () => {
    const w = makeWorld();
    const ok = await json(w, null)(
      "GET",
      "/api/forecast?latitude=1&longitude=2&hourly=snow_depth,uv_index",
    );
    expect(ok.status).toBe(200);
    expect(w.provider.calls[0]?.hourly).toContain("snow_depth");
    const bad = await json(w, null)("GET", "/api/forecast?latitude=1&longitude=2&hourly=made_up");
    expect(bad.status).toBe(400);
    const badCoords = await json(w, null)("GET", "/api/forecast?latitude=100&longitude=2");
    expect(badCoords.status).toBe(400);
  });
});
