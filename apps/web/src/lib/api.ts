import { createWeatherClient } from "@arena-weather/core";

/**
 * Same-origin client: in dev and in production every /api/* request is forwarded to the API
 * Worker by src/routes/api.$.ts, so the session cookie is a plain first-party cookie.
 */
export const api = createWeatherClient({ baseUrl: "" });

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string")
    return e.message;
  return String(e);
}
