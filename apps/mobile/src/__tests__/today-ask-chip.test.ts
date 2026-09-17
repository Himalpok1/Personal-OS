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

  it("sits inside the ONE hero block -- the daily briefing since 10.6 -- and never calls the Ask API itself", () => {
    // Checkpoint 10.3 moved the chip from the summary-chip row into the ONE
    // hero card, right under the overdue / due-today counts. Checkpoint 10.6
    // (ADR-076 §4) made that hero the deterministic daily briefing
    // (components/today/briefing-card.tsx, ADR-075 §4), whose headline
    // carries the same counts (briefing-card-state.test.ts pins that); the
    // chip is passed to it as children, so it still renders inside the one
    // gradient block, under the headline and the sections, gated exactly as
    // before: still no new section, no header icon, no sixth tab.
    const heroStart = today.indexOf("<BriefingCard>");
    const heroEnd = today.indexOf("</BriefingCard>");
    expect(heroStart).toBeGreaterThan(-1);
    expect(heroEnd).toBeGreaterThan(heroStart);
    const hero = today.slice(heroStart, heroEnd);
    expect(hero).toContain('testID="today-ask-chip"');
    // The screen draws no gradient of its own any more -- the briefing card
    // is the one `GradientCard gradient="hero"` on Today.
    expect(today).not.toContain("<GradientCard");
    expect(today).not.toContain("askCloud");
    expect(today).not.toContain("useAskCloud");
  });
});
