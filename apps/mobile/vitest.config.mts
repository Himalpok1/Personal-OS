import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only pure-logic modules are unit-tested here (see reconcile.ts's own
    // comment on why) -- everything else in this app is React Native/Expo
    // Router composition that would need a full RN test renderer, which
    // this checkpoint deliberately doesn't add. Scoping include this
    // tightly keeps vitest from trying to transform .tsx component files it
    // has no RN preset for.
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "modules/**"],
  },
});
