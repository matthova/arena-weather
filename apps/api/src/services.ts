import { type Auth, createAuth } from "./auth.js";
import { createRepo, type Repo } from "./db/repo.js";
import type { Env } from "./env.js";
import { createEmailSender, type EmailSender } from "./lib/email.js";
import type { ForecastProvider } from "./providers/forecast.js";
import { createOpenMeteoProvider } from "./providers/open-meteo.js";
import { createPushSender, type PushSender } from "./push/sender.js";

/** Everything the routes and the checker depend on; tests swap in fakes. */
export interface Services {
  env: Env;
  repo: Repo;
  auth: Auth;
  email: EmailSender;
  provider: ForecastProvider;
  push: PushSender;
}

export type ServicesFactory = (env: Env) => Services;

export function createServices(env: Env, overrides: Partial<Omit<Services, "env">> = {}): Services {
  const email = overrides.email ?? createEmailSender(env);
  return {
    env,
    repo: overrides.repo ?? createRepo(env.DB),
    auth: overrides.auth ?? createAuth(env, email),
    email,
    provider:
      overrides.provider ??
      createOpenMeteoProvider({
        forecastUrl: env.OPEN_METEO_FORECAST_URL,
        geocodingUrl: env.OPEN_METEO_GEOCODING_URL,
      }),
    push: overrides.push ?? createPushSender(env),
  };
}

const cache = new WeakMap<object, Services>();

/** One Services per env object (the Worker reuses it across requests in an isolate). */
export function memoize(factory: ServicesFactory): ServicesFactory {
  return (env) => {
    let s = cache.get(env);
    if (!s) {
      s = factory(env);
      cache.set(env, s);
    }
    return s;
  };
}
