import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests run against a real, dedicated test database (personalos_test), not
// mocks -- matches this codebase's established "verify against real
// Postgres" philosophy (see docs/STATUS.md's Phase 1/2 verification
// entries). Loading the repo-root .env first means TEST_DATABASE_URL and
// CREDENTIALS_ENCRYPTION_KEY are available without duplicating them into a
// separate test-only env file.
process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    // Route handlers/env.ts read process.env.DATABASE_URL directly -- this
    // is what actually redirects app.db at test-app-build time to the test
    // database instead of dev.
    env: {
      DATABASE_URL: process.env["TEST_DATABASE_URL"],
      // Isolated from the real default (/tmp/personal-os-audio) -- POST
      // /transcribe's route handler writes real files to disk, and without
      // this override the automated test suite would litter whatever
      // directory a real local dev run also uses. transcribe.test.ts's
      // afterAll removes this directory entirely once tests finish.
      AUDIO_STORAGE_PATH: "/tmp/personal-os-audio-test-api",
    },
    // Fastify + pg-boss startup (registerBoss retries on connect) is slow
    // enough that the default 5s hook timeout can flake under load.
    hookTimeout: 20_000,
    // All route test files share one physical database (personalos_test)
    // and each truncates its tables in beforeEach -- running files in
    // parallel (vitest's default) causes one file's truncation to wipe out
    // rows another file just inserted. Sequential execution trades speed
    // (there's little to lose at this suite's size) for correctness.
    fileParallelism: false,
  },
});
