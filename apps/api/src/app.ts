import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Session } from "./auth.js";
import { type Env, trustedOrigins } from "./env.js";
import { handleError } from "./lib/http.js";
import { forecastRoutes } from "./routes/forecast.js";
import { internalRoutes } from "./routes/internal.js";
import { metaRoutes } from "./routes/meta.js";
import { nativeRoutes } from "./routes/native.js";
import { placesRoutes } from "./routes/places.js";
import { pushRoutes } from "./routes/push.js";
import { pushDeviceRoutes } from "./routes/push-devices.js";
import { rulesRoutes } from "./routes/rules.js";
import { createServices, memoize, type Services, type ServicesFactory } from "./services.js";

export type AppEnv = {
  Bindings: Env;
  Variables: { services: Services; session: Session | null };
};

export function createApp(factory: ServicesFactory = memoize((env) => createServices(env))) {
  const app = new Hono<AppEnv>();

  app.onError(handleError);
  app.use(logger());

  app.use("*", async (c, next) => {
    c.set("services", factory(c.env));
    await next();
  });

  app.use(
    "/api/*",
    cors({
      origin: (origin, c) => {
        const allowed = [c.env.APP_URL, c.env.API_URL, ...trustedOrigins(c.env)].map((o) =>
          o.replace(/\/$/, ""),
        );
        return allowed.includes(origin) ? origin : null;
      },
      credentials: true,
      allowHeaders: ["content-type", "authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  // Better Auth owns everything under /api/auth/*
  app.on(["GET", "POST"], "/api/auth/*", (c) => c.get("services").auth.handler(c.req.raw));

  // Resolve the session once for the rest of the API
  app.use("/api/*", async (c, next) => {
    const session = await c.get("services").auth.api.getSession({ headers: c.req.raw.headers });
    c.set("session", session);
    await next();
  });

  app.route("/api", metaRoutes);
  app.route("/api/places", placesRoutes);
  app.route("/api/forecast", forecastRoutes);
  app.route("/api/rules", rulesRoutes);
  app.route("/api/push/devices", pushDeviceRoutes);
  app.route("/api/push", pushRoutes);
  app.route("/api/internal", internalRoutes);
  app.route("/api/native", nativeRoutes);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));
  return app;
}

export type App = ReturnType<typeof createApp>;
