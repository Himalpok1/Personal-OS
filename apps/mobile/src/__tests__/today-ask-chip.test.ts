import { describe, expect, it } from "vitest";

// app/(tabs)/index.tsx's default export is a hooked screen whose card
// imports (reminders, health, mail, brief) reach native modules that cannot
// load under vitest, so -- as new-event-screen.test.ts does -- the "Ask about
// today" chip's wiring (Checkpoint 9.7) is pinned by reading the source.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string, o: Record<string, unknown>) => Record<string, string>;
  }
).glob("../app/(tabs)/index.tsx", { query: "?raw", import: "default", eager: true });

const today = Object.values(SOURCES)[0]!;

describe("Today's 'Ask about today' chip (Checkpoint 9.7)", () => {
  it("is rendered ONLY when the 'ask' task route exists -- the same switch as the search screen", () => {
    expect(today).toMatch(/const askEnabled = useAskEnabled\(\)\.enabled;/);
    expect(today).toMatch(/\{askEnabled \? \(\s*<Pressable\s+testID="today-ask-chip"/);
  });

  it("pushes the search screen in Ask mode with the focus preset PRE-SELECTED -- a pre-fill, never a submission", () => {
    expect(today).toContain(
      'export const ASK_ABOUT_TODAY_HREF = "/search?mode=ask&preset=focus" as Href;',
    );
    expect(today).toMatch(/testID="today-ask-chip"[\s\S]*?router\.push\(ASK_ABOUT_TODAY_HREF\)/);
  });

  it("sits in the existing summary chip row and never calls the Ask API itself", () => {
    const chipRow = today.slice(
      today.indexOf('<Chip label="Overdue"'),
      today.indexOf('testID="today-ask-chip"'),
    );
    // Same flex-wrap row as the four summary chips: no new section, no
    // header icon, no sixth tab.
    expect(chipRow).toContain('label="Projects"');
    expect(chipRow).not.toContain("</View>");
    expect(today).not.toContain("askCloud");
    expect(today).not.toContain("useAskCloud");
  });
});
