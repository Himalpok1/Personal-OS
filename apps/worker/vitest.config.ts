import path from "node:path";
import { defineConfig } from "vitest/config";

// See apps/api/vitest.config.ts for the rationale -- same shared test
// database (personalos_test), same reason for overriding DATABASE_URL and
// for the root test script serializing Turbo package tasks.
process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    env: {
      DATABASE_URL: process.env["TEST_DATABASE_URL"],
      // Isolated from the real default (/tmp/personal-os-audio) and from
      // apps/api's own test directory -- see apps/api/vitest.config.ts's
      // comment for why. ptt-transcribe.test.ts and
      // sweep-orphan-audio.test.ts each remove this directory in afterAll.
      AUDIO_STORAGE_PATH: "/tmp/personal-os-audio-test-worker",
      // Overridden rather than inherited from .env, deliberately. This
      // workspace's .env holds the owner's REAL Gmail client credentials
      // (provisioned in Checkpoint 7.2), and a test suite that silently reads
      // them would (a) be environment-dependent, passing here and failing on any
      // machine without a Gmail connection, and (b) put a real client id into
      // the process every test run for no reason. Nothing in the mail tests ever
      // reaches Google -- every provider call goes through the scripted fake --
      // so these only need to be non-empty for `env.ts`'s optional-var check.
      GMAIL_OAUTH_CLIENT_ID: "test-only-not-a-real-client",
      GMAIL_OAUTH_CLIENT_SECRET: "test-only-not-a-real-secret",
    },
    fileParallelism: false,
  },
});
