import { describe, expect, it } from "vitest";

// Everything under src/app is Expo Router's ROUTES directory: any file placed
// there is treated as a route and pulled into the app bundle.
//
// Checkpoint 5.6 hit this for real. A colocated `events/new.test.ts` both
// registered a bogus `/events/new.test` route and, because it imports vitest,
// dragged vite -- a Node-only package -- into the web bundle, so
// `expo export --platform web` failed outright with
// "Invalid call at line 1018: import(filepath)" from vite/dist/node/
// module-runner.js. Nothing about that error names the real cause, and the
// repo-wide typecheck/lint/test gates were all still green, so it is exactly
// the kind of mistake that gets misfiled as "a pre-existing bundler issue".
//
// This guard makes it fail loudly and legibly instead. Pure helpers and their
// tests belong in src/utils (see utils/all-day-seed.ts).
// Implemented with Vite's compile-time `import.meta.glob` rather than node:fs
// on purpose: apps/mobile is a React Native app whose tsconfig deliberately
// does NOT include @types/node, and pulling Node types in just for this guard
// would make Node globals look available to application code too.
const offenders = Object.keys(
  (import.meta as unknown as { glob: (p: string) => Record<string, unknown> }).glob(
    "../app/**/*.{test,spec}.{ts,tsx,js,jsx}",
  ),
);

describe("src/app is routes-only", () => {
  it("contains no test files", () => {
    expect(offenders).toEqual([]);
  });
});
