import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env as ApiEnv } from "../src/env.js";

declare global {
  namespace Cloudflare {
    interface Env extends ApiEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
