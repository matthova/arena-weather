import type { RuleEvaluation } from "./evaluate.js";
import type { Forecast, PlaceSearchResult } from "./forecast.js";
import type { Rule, RuleDefinitionInput } from "./rule.js";
import type { WeatherVariable } from "./variables.js";

// --- Wire types shared by the API and its clients ------------------------------

export interface ApiError {
  error: { code: string; message: string; issues?: unknown };
}

export interface PlacesSearchResponse {
  results: PlaceSearchResult[];
}

export interface ForecastQuery {
  latitude: number;
  longitude: number;
  timezone?: string;
  /** Extra hourly variables beyond the defaults. */
  hourly?: string[];
  /** Extra daily variables beyond the defaults. */
  daily?: string[];
}

export interface RulesListResponse {
  rules: Rule[];
}
export interface RuleResponse {
  rule: Rule;
}

export interface RuleTestResponse {
  rule: Rule;
  evaluation: RuleEvaluation;
  /** Notification text that was (or would be) sent. */
  message: string;
  push: { attempted: number; delivered: number; failed: number };
}

export interface PushSubscriptionJSONLike {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export interface PushRegisterResponse {
  subscription: { id: string; endpoint: string; createdAt: string };
}

export interface PushListResponse {
  subscriptions: { id: string; endpoint: string; createdAt: string; userAgent: string | null }[];
}

export interface PushPublicKeyResponse {
  publicKey: string;
}

export interface VariablesResponse {
  variables: WeatherVariable[];
}

export interface HealthResponse {
  ok: true;
  version: string;
  time: string;
}

// --- Client --------------------------------------------------------------------

export class WeatherApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: unknown;
  constructor(status: number, body: ApiError["error"] | undefined) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.name = "WeatherApiError";
    this.status = status;
    this.code = body?.code ?? "unknown";
    this.issues = body?.issues;
  }
}

export interface WeatherClientOptions {
  /** e.g. "https://api.example.com" or "" for same-origin. No trailing slash. */
  baseUrl: string;
  /** Override fetch (tests, Node < 18, custom agents). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Extra headers on every request (e.g. a bearer token for native clients). */
  headers?: Record<string, string>;
  /** Send cookies (browser session auth). Default "include". */
  credentials?: RequestCredentials;
}

export function createWeatherClient(options: WeatherClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("No fetch implementation available");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", ...options.headers };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      credentials: options.credentials ?? "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) throw new WeatherApiError(res.status, (json as ApiError | undefined)?.error);
    return json as T;
  }

  const qs = (params: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params))
      if (v !== undefined && v !== "") sp.set(k, String(v));
    const s = sp.toString();
    return s ? `?${s}` : "";
  };

  return {
    health: () => request<HealthResponse>("GET", "/api/health"),
    variables: () => request<VariablesResponse>("GET", "/api/variables"),

    searchPlaces: (query: string, opts?: { count?: number; language?: string }) =>
      request<PlacesSearchResponse>(
        "GET",
        `/api/places/search${qs({ q: query, count: opts?.count, language: opts?.language })}`,
      ),

    getForecast: (q: ForecastQuery) =>
      request<Forecast>(
        "GET",
        `/api/forecast${qs({
          latitude: q.latitude,
          longitude: q.longitude,
          timezone: q.timezone,
          hourly: q.hourly?.join(","),
          daily: q.daily?.join(","),
        })}`,
      ),

    listRules: () => request<RulesListResponse>("GET", "/api/rules"),
    getRule: (id: string) => request<RuleResponse>("GET", `/api/rules/${encodeURIComponent(id)}`),
    createRule: (definition: RuleDefinitionInput) =>
      request<RuleResponse>("POST", "/api/rules", definition),
    updateRule: (id: string, definition: RuleDefinitionInput) =>
      request<RuleResponse>("PUT", `/api/rules/${encodeURIComponent(id)}`, definition),
    deleteRule: (id: string) => request<void>("DELETE", `/api/rules/${encodeURIComponent(id)}`),
    pauseRule: (id: string) =>
      request<RuleResponse>("POST", `/api/rules/${encodeURIComponent(id)}/pause`),
    resumeRule: (id: string) =>
      request<RuleResponse>("POST", `/api/rules/${encodeURIComponent(id)}/resume`),
    /** Evaluate now and send a push to the caller's subscriptions regardless of trigger state. */
    testRule: (id: string) =>
      request<RuleTestResponse>("POST", `/api/rules/${encodeURIComponent(id)}/test`),

    pushPublicKey: () => request<PushPublicKeyResponse>("GET", "/api/push/public-key"),
    listPushSubscriptions: () => request<PushListResponse>("GET", "/api/push/subscriptions"),
    registerPush: (subscription: PushSubscriptionJSONLike, userAgent?: string) =>
      request<PushRegisterResponse>("POST", "/api/push/subscriptions", { subscription, userAgent }),
    unregisterPush: (endpoint: string) =>
      request<void>("DELETE", "/api/push/subscriptions", { endpoint }),
  };
}

export type WeatherClient = ReturnType<typeof createWeatherClient>;
