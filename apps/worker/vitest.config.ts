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
      // Isolated from the real default (/tmp/personal-os-audio) and from
      // apps/api's own test directory -- see apps/api/vitest.config.ts's
      // comment for why. ptt-transcribe.test.ts and
      // sweep-orphan-audio.test.ts each remove this directory in afterAll.
      AUDIO_STORAGE_PATH: "/tmp/personal-os-audio-test-worker",
    },
    fileParallelism: false,
  },
});
