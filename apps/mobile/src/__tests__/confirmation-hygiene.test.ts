import { describe, expect, it } from "vitest";

// A guard, not a style rule.
//
// `Alert.alert` is an EMPTY NO-OP on react-native-web:
//
//     class Alert { static alert() {} }
//
// It accepts the arguments and does nothing, so the confirm callback never fires
// and the guarded action silently does not happen. This app ships web
// (docs/ARCHITECTURE.md: one universal Expo codebase for iOS, Android and web),
// so a destructive button wired straight to it is not "unconfirmed" -- it is
// INERT, and the user believes they cancelled something they never triggered.
//
// Checkpoint 7.6 found it and fixed the two sites it had added. Checkpoint 7.7
// swept the remaining nine. This test is what stops the tenth from appearing.
//
// Implemented with Vite's compile-time `import.meta.glob` rather than node:fs,
// for the reason routes-hygiene.test.ts records: apps/mobile's tsconfig
// deliberately excludes @types/node, and pulling Node types in for a guard
// would make Node globals look available to application code too.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string, o: Record<string, unknown>) => Record<string, string>;
  }
).glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

// THREE call sites are allowed, and none of them is a defect:
//
//   * components/confirm-destructive.ts is THE sanctioned wrapper -- the one
//     place Alert.alert belongs, reached only after an explicit Platform check.
//   * notifications/exact-alarm.ts returns early unless Platform.OS ===
//     "android", so its prompt cannot run on web at all.
//   * components/quick-add-fab.tsx shows a one-button INFORMATIONAL notice.
//     Nothing is lost when it does not appear -- the capture is already queued --
//     and a blocking window.confirm would be worse than silence.
const ALLOWED = [
  "../components/confirm-destructive.ts",
  "../notifications/exact-alarm.ts",
  "../components/quick-add-fab.tsx",
];

function source(path: string): string {
  const found = SOURCES[path];
  if (found === undefined) throw new Error(`${path} not found -- update ALLOWED`);
  return found;
}

describe("confirmation hygiene", () => {
  it("has no Alert.alert outside the three allowed, non-destructive sites", () => {
    // If this fails, the new call site is INERT on web. Use `confirmDestructive`
    // from components/confirm-destructive.ts, which asks on every platform -- or
    // add the file to ALLOWED with a reason, if it is genuinely informational or
    // platform-gated.
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([path, body]) => body.includes("Alert.alert(") && !ALLOWED.includes(path))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist accurate -- every entry still calls Alert.alert", () => {
    // An allowlist that drifts is worse than none: it would keep excusing a file
    // that has since become a real destructive confirmation.
    for (const path of ALLOWED) {
      expect(source(path), `${path} no longer calls Alert.alert -- drop it`).toContain(
        "Alert.alert(",
      );
    }
  });

  it("the wrapper reaches Alert.alert only on native", () => {
    // Its exemption rests on branching to window.confirm first, which is the
    // entire reason every other call site routes through it.
    const body = source("../components/confirm-destructive.ts");
    expect(body).toContain('if (Platform.OS === "web")');
    expect(body.indexOf('Platform.OS === "web"')).toBeLessThan(body.indexOf("Alert.alert("));
  });

  it("the exact-alarm prompt is still platform-gated", () => {
    expect(source("../notifications/exact-alarm.ts")).toContain(
      'if (Platform.OS !== "android") return true;',
    );
  });

  it("the quick-add notice is still a ONE-button informational alert", () => {
    // Its exemption rests on having no action to lose. A button would mean an
    // action that silently does not fire.
    const body = source("../components/quick-add-fab.tsx");
    const call = body.slice(body.indexOf("Alert.alert("));
    expect(call.slice(0, call.indexOf(");"))).not.toContain("onPress");
  });
});
