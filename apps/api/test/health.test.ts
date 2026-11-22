import { describe, expect, it } from "vitest";
import { json, makeWorld } from "./helpers.js";

describe("meta", () => {
  it("GET /api/health", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/health");
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
  });
  it("GET /api/variables lists hourly and daily variables", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/variables");
    expect(r.status).toBe(200);
    expect(r.data.variables.some((v: { name: string }) => v.name === "temperature_2m")).toBe(true);
  });
  it("unknown routes are JSON 404s", async () => {
    const w = makeWorld();
    const r = await json(w, null)("GET", "/api/nope");
    expect(r.status).toBe(404);
    expect(r.data.error.code).toBe("not_found");
  });
});
