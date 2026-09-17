import { describe, expect, it } from "vitest";

// Checkpoint 10.6: a `useAnimatedStyle` / `useAnimatedProps` / `useDerivedValue`
// body runs on Reanimated's UI runtime, where a plain JS-thread function is a
// "remote function" and calling it synchronously is a FATAL native error --
// `[Worklets] Tried to synchronously call a Remote Function` -- that the
// vitest mocks (identity `useAnimatedStyle`) and the web build can never
// surface. The versionCode-30 Rabbit build crashed on launch because
// `bottom-sheet.tsx`'s style worklet called the exported `sheetTranslateY`.
//
// This guard reads every animated body from source and allows only property
// reads (`.get()`), arithmetic/`Math.*`, template strings, and the names
// listed below, each of which is a function whose body starts with the
// `"worklet"` directive (checked here too, by name).
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string[], o: Record<string, unknown>) => Record<string, string>;
  }
).glob(["../components/**/*.tsx", "../components/**/*.ts", "../app/**/*.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Calls a worklet body may make besides `.get()` and `Math.*`. */
const ALLOWED_CALLS: Readonly<Record<string, string[]>> = {
  // `format` is a caller-supplied worklet (documented on AnimatedNumberProps);
  // the default, `formatGroupedInteger`, carries the directive below.
  "../components/ui/animated-number.tsx": ["format"],
};

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

/** Every `useAnimated*(() => ...)` body, by balanced-paren scan from the arrow. */
function animatedBodies(source: string): string[] {
  const bodies: string[] = [];
  const re = /use(?:AnimatedStyle|AnimatedProps|DerivedValue)\(\s*\(\)\s*=>/g;
  while (re.exec(source) !== null) {
    let depth = 1; // inside useAnimated*( ... )
    let i = re.lastIndex;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
    }
    bodies.push(source.slice(re.lastIndex, i - 1));
  }
  return bodies;
}

describe("animated bodies never call a JS-thread function", () => {
  const files = Object.entries(SOURCES).filter(([path]) => !path.endsWith(".test.tsx"));

  it("finds the bodies this guard exists for", () => {
    const total = files.reduce((n, [, src]) => n + animatedBodies(stripComments(src)).length, 0);
    expect(total).toBeGreaterThanOrEqual(6); // bottom-sheet ×2, pressable-scale, completion-circle, grade-progress, workload-bar, animated-number
  });

  for (const [path, raw] of files) {
    const source = stripComments(raw);
    const bodies = animatedBodies(source);
    if (bodies.length === 0) continue;
    it(`${path} calls only .get(), Math.* and declared worklets`, () => {
      const allowed = new Set(ALLOWED_CALLS[path] ?? []);
      for (const body of bodies) {
        const calls = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]!);
        const offending = calls.filter((name) => name !== "get" && !allowed.has(name));
        expect(offending, `${path}: ${body.trim()}`).toEqual([]);
        // `.get()` and Math.* member calls are the only member calls allowed.
        const members = [...body.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]!);
        expect(
          members.filter((m) => m !== "get" && !/^(abs|round|min|max|floor|ceil)$/.test(m)),
        ).toEqual([]);
      }
    });
  }

  it("every function a worklet body is allowed to call carries the worklet directive", () => {
    const animatedNumber = stripComments(SOURCES["../components/ui/animated-number.tsx"]!);
    expect(animatedNumber).toMatch(/function formatGroupedInteger\([^)]*\)[^{]*\{\s*"worklet";/);
    const sheet = stripComments(SOURCES["../components/ui/bottom-sheet.tsx"]!);
    expect(sheet).toMatch(/function sheetTranslateY\([^)]*\)[^{]*\{\s*"worklet";/);
    // And the sheet's style worklet inlines the arithmetic rather than calling out.
    for (const body of animatedBodies(sheet)) expect(body).not.toContain("sheetTranslateY(");
  });
});
