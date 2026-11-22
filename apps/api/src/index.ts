import { createApp } from "./app.js";
import { runChecker } from "./checker.js";
import type { Env } from "./env.js";
import { createServices, memoize } from "./services.js";

const services = memoize((env: Env) => createServices(env));
const app = createApp(services);

export default {
  fetch: app.fetch,
  /** Cron Trigger (every 15 minutes, see wrangler.jsonc). Locally: `curl "http://localhost:8787/__scheduled"` with --test-scheduled. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runChecker(services(env)));
  },
} satisfies ExportedHandler<Env>;

export { createApp };
