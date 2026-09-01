import path from "node:path";
import { defineConfig } from "vitest/config";

// This package owns the incident state machine, which is inseparable from the
// database that enforces "one active incident per target" -- so its tests are
// DB-backed and run against the same dedicated `personalos_test` database
// apps/api and apps/worker use.
//
// `fileParallelism: false` and the root test script's `--concurrency=1` are what
// keep three packages sharing one database from producing shifting, meaningless
// failures in each other's suites -- the measurement artefact Checkpoint 6.3
// recorded and traced to concurrent runs.
process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    env: { DATABASE_URL: process.env["TEST_DATABASE_URL"] },
    fileParallelism: false,
  },
});
