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
      // Deterministic Google Health OAuth config for route tests. These are
      // not credentials -- they are placeholders; every outbound call is either
      // a stubbed global fetch or the injected in-memory fake client, so no
      // test ever reaches Google. The redirect list is deliberately the REAL
      // registered callback plus a second entry, so allowlist and
      // redirect-binding behaviour are exercised against realistic values.
      GOOGLE_HEALTH_OAUTH_CLIENT_ID: "test-health-client-id",
      GOOGLE_HEALTH_OAUTH_CLIENT_SECRET: "test-health-client-secret",
      GOOGLE_HEALTH_OAUTH_REDIRECT_URI:
        "https://personal-os.tail62a68f.ts.net/health-connections/google/callback,https://alt.example.ts.net/health-connections/google/callback",
      // Deterministic Gmail OAuth config (Phase 7 Checkpoint 7.2), same
      // reasoning as the Health trio above: placeholders, never credentials.
      // Every outbound call is a stubbed global fetch or the injected scripted
      // fake, so no test reaches Google. The redirect list is the real
      // production callback plus a second entry, so the exact-match allowlist
      // and redirect-binding checks run against realistic values.
      //
      // The "Gmail omitted / empty-string" startup cases deliberately do NOT
      // rely on this: env-mail-config.test.ts re-parses the schema in-process
      // with those shapes, because a vitest `env` block cannot express an
      // absent variable for one file while another needs it present.
      GMAIL_OAUTH_CLIENT_ID: "test-gmail-client-id",
      GMAIL_OAUTH_CLIENT_SECRET: "test-gmail-client-secret",
      GMAIL_OAUTH_REDIRECT_URI:
        "https://personal-os.tail62a68f.ts.net/mail-connections/gmail/callback,https://alt.example.ts.net/mail-connections/gmail/callback",
    },
    // Fastify + pg-boss startup (registerBoss retries on connect) is slow
    // enough that the default 5s hook timeout can flake under load.
    hookTimeout: 20_000,
    // All route test files share one physical database (personalos_test)
    // and each truncates its tables in beforeEach -- running files in
    // parallel (vitest's default) causes one file's truncation to wipe out
    // rows another file just inserted. The root test script also serializes
    // Turbo package tasks because apps/worker shares this same database.
    fileParallelism: false,
  },
});
