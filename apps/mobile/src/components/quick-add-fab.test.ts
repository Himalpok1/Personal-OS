import { describe, expect, it } from "vitest";

// quick-add-fab.tsx imports expo-crypto and react-native-safe-area-context,
// neither of which loads under the mobile vitest transform, so -- as
// queries/monitor.test.ts and queries/ask.test.ts do -- the wiring that
// matters is pinned by reading the module's source. The behaviour behind it
// (the bounded poll, the copy, the destination) is covered by
// components/inbox/capture-follow-through.test.ts and
// components/inbox/use-capture-follow-through.test.ts.
const source = (
  import.meta as unknown as {
    glob: (p: string, o: Record<string, unknown>) => Record<string, string>;
  }
).glob("./quick-add-fab.tsx", { query: "?raw", import: "default", eager: true })[
  "./quick-add-fab.tsx"
]!;

describe("QuickAddFab capture follow-through (Checkpoint 9.3 D3-lite)", () => {
  it("starts the follow-through only for a SENT capture, which is the only one with an inbox id", () => {
    expect(source).toMatch(
      /if \(result\.status === "sent"\) \{\s*followThrough\.start\(result\.inbox_id\);/,
    );
    // A queued capture keeps the existing offline notice and starts nothing.
    expect(source).not.toMatch(/status === "queued"\)[\s\S]{0,200}followThrough\.start/);
  });

  it("derives the banner's copy and destination from the shared helpers, never from capture text", () => {
    expect(source).toMatch(/followThroughLabel\(state\.outcome\)/);
    expect(source).toMatch(/followThroughRoute\(state\.outcome\)/);
    expect(source).not.toMatch(/router\.push\(`\/inbox\//);
    expect(source).not.toMatch(/router\.push\(text/);
  });

  it("clears the banner before navigating, so a tap never leaves a stale result behind", () => {
    expect(source).toMatch(/followThrough\.dismiss\(\);\s*router\.push\(route as Href\)/);
  });
});

describe("QuickAddFab content bounds (Checkpoint 9.6)", () => {
  it("bounds the composer at CAPTURE_TEXT_MAX_LENGTH -- the same constant the share normaliser truncates at", () => {
    expect(source).toMatch(/import \{ CAPTURE_TEXT_MAX_LENGTH \} from "@personal-os\/schema"/);
    expect(source).toMatch(/<TextInput[\s\S]*?maxLength=\{CAPTURE_TEXT_MAX_LENGTH\}[\s\S]*?\/>/);
    expect(source).toMatch(/<FieldLengthCounter[\s\S]*?maxLength=\{CAPTURE_TEXT_MAX_LENGTH\}/);
  });

  it("names a refused field before falling back to the connection line", () => {
    expect(source).toMatch(
      /describeValidationError\(capture\.error\) \?\?\s*"Couldn't save that -- check your connection and try again\."/,
    );
  });
});
