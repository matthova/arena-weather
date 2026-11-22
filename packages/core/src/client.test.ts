import { describe, expect, it } from "vitest";
import { createWeatherClient, WeatherApiError } from "./client.js";

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { fetch: f, calls };
}

describe("createWeatherClient", () => {
  it("builds URLs with query strings and parses JSON", async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(JSON.stringify({ results: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createWeatherClient({ baseUrl: "https://api.test/", fetch });
    const res = await client.searchPlaces("Ber lin", { count: 5 });
    expect(res).toEqual({ results: [] });
    expect(calls[0]?.url).toBe("https://api.test/api/places/search?q=Ber+lin&count=5");
    expect(calls[0]?.init.credentials).toBe("include");
  });

  it("sends JSON bodies and merges headers", async () => {
    const { fetch, calls } = fakeFetch(() => new Response(JSON.stringify({ rule: { id: "r1" } })));
    const client = createWeatherClient({
      baseUrl: "",
      fetch,
      headers: { authorization: "Bearer t" },
    });
    await client.createRule({
      name: "x",
      place: { label: "B", latitude: 1, longitude: 2 },
      root: { type: "group", operator: "all", children: [] },
    });
    const init = calls[0]?.init;
    expect(calls[0]?.url).toBe("/api/rules");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer t");
    expect(JSON.parse(init?.body as string).name).toBe("x");
  });

  it("throws WeatherApiError with the server's code on failure, and handles 204", async () => {
    const { fetch } = fakeFetch((url) =>
      url.endsWith("/api/rules/missing")
        ? new Response(JSON.stringify({ error: { code: "not_found", message: "No such rule" } }), {
            status: 404,
          })
        : new Response(null, { status: 204 }),
    );
    const client = createWeatherClient({ baseUrl: "http://x", fetch });
    await expect(client.getRule("missing")).rejects.toMatchObject({
      name: "WeatherApiError",
      status: 404,
      code: "not_found",
      message: "No such rule",
    });
    await expect(client.deleteRule("r1")).resolves.toBeUndefined();
    expect(new WeatherApiError(500, undefined).code).toBe("unknown");
  });
});
