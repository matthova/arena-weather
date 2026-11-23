import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
            API_URL: "http://localhost:8787",
            APP_URL: "http://localhost:3000",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
      // Better Auth signals handled outcomes (403 "e-mail not verified", 302 redirects) by throwing
      // APIError inside AsyncLocalStorage.run; workerd reports those as unhandled rejections even
      // though Better Auth catches them and turns them into the response. Only that error type is ignored.
      onUnhandledError(error) {
        const e = error as { name?: string; statusCode?: number };
        if (e?.name === "APIError" && typeof e.statusCode === "number") return false;
      },
    },
  };
});
