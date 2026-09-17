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

  it("sits inside the day-at-a-glance hero, under its counts, and never calls the Ask API itself", () => {
    // Checkpoint 10.3 moved the chip from the summary-chip row into the ONE
    // hero card, right under the same overdue / due-today counts: still no
    // new section, no header icon, no sixth tab.
    const heroStart = today.indexOf('<GradientCard gradient="hero"');
    const heroEnd = today.indexOf("</GradientCard>");
    expect(heroStart).toBeGreaterThan(-1);
    expect(heroEnd).toBeGreaterThan(heroStart);
    const hero = today.slice(heroStart, heroEnd);
    expect(hero).toContain('testID="today-ask-chip"');
    expect(hero).toContain("data.summary.overdue_total");
    expect(hero).toContain("data.summary.due_today_total");
    expect(hero.indexOf("data.summary.due_today_total")).toBeLessThan(
      hero.indexOf('testID="today-ask-chip"'),
    );
    expect(today).not.toContain("askCloud");
    expect(today).not.toContain("useAskCloud");
  });
});
