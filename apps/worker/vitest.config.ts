import path from "node:path";
import { defineConfig } from "vitest/config";

// See apps/api/vitest.config.ts for the rationale -- same shared test
// database (personalos_test), same reason for overriding DATABASE_URL.
process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    env: {
      DATABASE_URL: process.env["TEST_DATABASE_URL"],
    },
    fileParallelism: false,
  },
});
