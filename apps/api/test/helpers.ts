import { env } from "cloudflare:test";
import type { Forecast, PlaceSearchResult } from "@arena-weather/core";
import { createApp } from "../src/app.js";
import { createRepo } from "../src/db/repo.js";
import type { Env } from "../src/env.js";
import type { EmailMessage, EmailSender } from "../src/lib/email.js";
import type { ForecastProvider, ForecastRequest } from "../src/providers/forecast.js";
import type { ApnsSender } from "../src/push/apns-sender.js";
import type { FcmSender } from "../src/push/fcm.js";
import type { PushMessage, PushSender } from "../src/push/sender.js";
import type { PushSubscriptionKeys } from "../src/push/webpush.js";
import { createServices, type Services } from "../src/services.js";

export const HOUR = 3600;
export const DAY = 86400;

/** A forecast where every hourly/daily variable asked for has a constant value (overridable per variable). */
export function fakeForecast(
  req: ForecastRequest,
  values: Record<string, number | ((i: number) => number)> = {},
  now = Math.floor(Date.now() / 1000),
): Forecast {
  const dayStart = now - (now % DAY);
  const hourlyTime = Array.from(
    { length: 24 * (req.forecastDays ?? 7) },
    (_, i) => dayStart + i * HOUR,
  );
  const dailyTime = Array.from({ length: req.forecastDays ?? 7 }, (_, i) => dayStart + i * DAY);
  const fill = (time: number[], names: string[]) => {
    const out: Record<string, (number | null)[]> = {};
    for (const n of names) {
      const v = values[n] ?? 0;
      out[n] = time.map((_, i) => (typeof v === "function" ? v(i) : v));
    }
    return out;
  };
  return {
    latitude: req.latitude,
    longitude: req.longitude,
    timezone: "UTC",
    utcOffsetSeconds: 0,
    units: {},
    current: req.current?.length
      ? { time: now, values: Object.fromEntries(req.current.map((n) => [n, 1])) }
      : undefined,
    hourly: { time: hourlyTime, values: fill(hourlyTime, req.hourly) },
    daily: { time: dailyTime, values: fill(dailyTime, req.daily) },
  };
}

export function fakeProvider(values: Record<string, number | ((i: number) => number)> = {}) {
  const calls: ForecastRequest[] = [];
  const provider: ForecastProvider & { calls: ForecastRequest[]; values: typeof values } = {
    name: "fake",
    calls,
    values,
    async geocode({ query }) {
      const results: PlaceSearchResult[] = [
        {
          id: 1,
          name: query,
          label: `${query}, Testland`,
          latitude: 52.52,
          longitude: 13.41,
          country: "Testland",
          timezone: "Europe/Berlin",
        },
      ];
      return results;
    },
    async forecast(req) {
      calls.push(req);
      return fakeForecast(req, provider.values);
    },
  };
  return provider;
}

export function fakePush(opts: { fail?: (endpoint: string) => number } = {}) {
  const sent: { subscription: PushSubscriptionKeys; message: PushMessage }[] = [];
  const sender: PushSender & { sent: typeof sent } = {
    enabled: true,
    publicKey: "BFakePublicKey",
    sent,
    async send(subscription, message) {
      sent.push({ subscription, message });
      const status = opts.fail?.(subscription.endpoint) ?? 201;
      return { ok: status < 300, status, gone: status === 404 || status === 410 };
    },
  };
  return sender;
}

/** An FCM sender that records what it was asked to send; `fail` picks a status per device token. */
export function fakeFcm(opts: { fail?: (token: string) => number; enabled?: boolean } = {}) {
  const sent: { token: string; message: PushMessage }[] = [];
  const sender: FcmSender & { sent: typeof sent } = {
    enabled: opts.enabled ?? true,
    projectId: "fake-project",
    sent,
    async send(token, message) {
      sent.push({ token, message });
      const status = opts.fail?.(token) ?? 200;
      return { ok: status < 300, status, gone: status === 404 };
    },
  };
  return sender;
}

/** An APNs sender that records what it was asked to send; `fail` picks a status per device token. */
export function fakeApns(opts: { fail?: (token: string) => number; enabled?: boolean } = {}) {
  const sent: { token: string; message: PushMessage }[] = [];
  const sender: ApnsSender & { sent: typeof sent } = {
    enabled: opts.enabled ?? true,
    bundleId: "com.example.weatheralerts",
    sent,
    async send(token, message) {
      sent.push({ token, message });
      const status = opts.fail?.(token) ?? 200;
      return { ok: status < 300, status, gone: status === 410 };
    },
  };
  return sender;
}

export function fakeEmail() {
  const sent: EmailMessage[] = [];
  const sender: EmailSender & { sent: EmailMessage[] } = {
    sent,
    async send(m) {
      sent.push(m);
    },
  };
  return sender;
}

export interface TestWorld {
  app: ReturnType<typeof createApp>;
  services: Services;
  provider: ReturnType<typeof fakeProvider>;
  push: ReturnType<typeof fakePush>;
  fcm: ReturnType<typeof fakeFcm>;
  apns: ReturnType<typeof fakeApns>;
  email: ReturnType<typeof fakeEmail>;
  env: Env;
}

export function makeWorld(
  overrides: {
    env?: Partial<Env>;
    push?: PushSender;
    fcm?: ReturnType<typeof fakeFcm>;
    apns?: ReturnType<typeof fakeApns>;
  } = {},
): TestWorld {
  const testEnv: Env = { ...env, ...overrides.env };
  const provider = fakeProvider();
  const push = fakePush();
  const fcm = overrides.fcm ?? fakeFcm();
  const apns = overrides.apns ?? fakeApns();
  const email = fakeEmail();
  const services = createServices(testEnv, {
    provider,
    push: overrides.push ?? push,
    fcm,
    apns,
    email,
    repo: createRepo(testEnv.DB),
  });
  const app = createApp(() => services);
  return { app, services, provider, push, fcm, apns, email, env: testEnv };
}

let userCounter = 0;

/** Sign up, mark the e-mail verified (as the verification link would), sign in; returns the session cookie. */
export async function signUpAndSignIn(
  world: TestWorld,
  emailAddress?: string,
): Promise<{ cookie: string; userId: string; email: string }> {
  const emailAddr =
    emailAddress ?? `user${++userCounter}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = "correct horse battery staple";
  const signUp = await world.app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: world.env.APP_URL },
      body: JSON.stringify({ name: "Test User", email: emailAddr, password }),
    },
    world.env,
  );
  if (signUp.status !== 200)
    throw new Error(`sign-up failed: ${signUp.status} ${await signUp.text()}`);
  await world.env.DB.prepare('UPDATE "user" SET "emailVerified" = 1 WHERE "email" = ?')
    .bind(emailAddr)
    .run();
  const signIn = await world.app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: world.env.APP_URL },
      body: JSON.stringify({ email: emailAddr, password }),
    },
    world.env,
  );
  if (signIn.status !== 200)
    throw new Error(`sign-in failed: ${signIn.status} ${await signIn.text()}`);
  const setCookie = signIn.headers.getSetCookie?.() ?? [signIn.headers.get("set-cookie") ?? ""];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const row = await world.env.DB.prepare('SELECT "id" FROM "user" WHERE "email" = ?')
    .bind(emailAddr)
    .first<{ id: string }>();
  if (!row) throw new Error("user not found after sign-up");
  return { cookie, userId: row.id, email: emailAddr };
}

export function json(world: TestWorld, cookie: string | null) {
  return async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { origin: world.env.APP_URL };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await world.app.request(
      path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      world.env,
    );
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    // biome-ignore lint/suspicious/noExplicitAny: test helper, assertions narrow the shape
    return { status: res.status, data: data as any, headers: res.headers };
  };
}

export const sampleRule = (overrides: Record<string, unknown> = {}) => ({
  name: "Rain in Berlin",
  place: { label: "Berlin", latitude: 52.52, longitude: 13.41 },
  window: { hoursAhead: 12 },
  root: {
    type: "group",
    operator: "all",
    children: [
      {
        type: "condition",
        granularity: "hourly",
        variable: "precipitation_probability",
        comparator: ">=",
        value: 60,
      },
    ],
  },
  ...overrides,
});
