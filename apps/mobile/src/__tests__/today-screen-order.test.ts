import { describe, expect, it } from "vitest";

// app/(tabs)/index.tsx is a hooked screen whose card imports reach native
// modules that cannot load under vitest, so -- as today-ask-chip.test.ts and
// today-suggested-focus.test.ts do -- the Checkpoint 10.6 reorganisation
// (ADR-076 §4) is pinned by reading the source.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string, o: Record<string, unknown>) => Record<string, string>;
  }
).glob("../app/(tabs)/index.tsx", { query: "?raw", import: "default", eager: true });

const today = Object.values(SOURCES)[0]!;

/** The index of each marker inside the screen's returned tree, in source order. */
function positions(markers: readonly string[]): number[] {
  const body = today.slice(today.indexOf("<Screen safeTop"));
  return markers.map((marker) => {
    const at = body.indexOf(marker);
    if (at === -1) throw new Error(`marker not found in Today's tree: ${marker}`);
    return at;
  });
}

describe("Today's order (Checkpoint 10.6, ADR-076 §4)", () => {
  it("is header → briefing → reminder notice → Focus Now → Suggested Focus → Overdue → Due today → Events → Brief → Health → Mail → Academics → reviews → Upcoming → Inbox → Projects", () => {
    const order = positions([
      "<ScreenHeader",
      "<BriefingCard>",
      "<ReminderNoticeCard />",
      "<FocusNowCard />",
      "<SuggestedFocusCard",
      'title="Overdue"',
      'title="Due today"',
      "<EventsSection",
      "<BriefCard />",
      "<HealthTodayCard />",
      "<MailDigestCard />",
      "<AcademicTodayCard />",
      "<ReviewsBlock",
      "<UpcomingSection",
      "<InboxSection",
      "<ProjectsSection",
    ]);
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
  });

  it("draws exactly one gradient block (the briefing) and no duplicate stat row", () => {
    expect(today).not.toContain("<GradientCard");
    expect(today).not.toContain("<MetricCard");
    expect(today).not.toContain("HeroStat");
  });

  it("keeps Inbox and Projects reachable from their section headers", () => {
    expect(today).toMatch(/label: "Open inbox",\s*onPress: \(\) => router\.push\(INBOX_ROUTE\)/);
    expect(today).toMatch(
      /label: "All projects",\s*onPress: \(\) => router\.push\(PROJECTS_ROUTE\)/,
    );
  });

  it("gives every task row a completion circle, a Done swipe and an entering animation, through the shared actions hook", () => {
    expect(today).toContain("<CompletionCircle");
    expect(today).toMatch(/<SwipeableRow\s+rightActions=\{\[\s*\{\s*key: "done"/);
    expect(today).toMatch(/entering=\{enterRise\}/);
    expect(today).toContain("const actions = useTodayTaskActions();");
    expect(today).toMatch(/showToast\(\{ message: "Completed", tone: "success" \}\)/);
    // The hand-rolled circle and the local copy of the completion rule are gone.
    expect(today).not.toContain("useCompleteTask");
    expect(today).not.toContain("useCompleteOccurrence");
    expect(today).not.toContain('checkbox-blank-circle-outline" size="lg"');
  });

  it("uses the shared compact EmptyState for an empty events section", () => {
    expect(today).toMatch(
      /<EmptyState size="compact" icon="calendar-blank-outline" title="No events today" \/>/,
    );
    expect(today).not.toContain("No events today.");
  });

  it("collapses the two idle review banners into one card of two rows", () => {
    expect(today).toMatch(
      /reviews\.daily\.status === null && reviews\.weekly\.status === null[\s\S]*?<ListRow\s+title="Daily review"[\s\S]*?<ListRow\s+title="Weekly review"/,
    );
  });

  it("makes upcoming rows pressable to their task or event", () => {
    const upcoming = today.slice(
      today.indexOf("function UpcomingSection"),
      today.indexOf("function InboxSection"),
    );
    expect(upcoming).toMatch(/onPress=\{\(\) => router\.push\(`\/tasks\/\$\{task\.id\}`\)\}/);
    expect(upcoming).toMatch(
      /onPress=\{\(\) => router\.push\(eventDetailHref\(event\.id, event\.occurs_at\) as Href\)\}/,
    );
  });

  it("mounts no assignment sheet host of its own -- the one host lives at the root (ADR-076 §3, 10.6 review finding 2)", () => {
    expect(today.match(/<AssignmentSheetHost \/>/g)).toBeNull();
  });
});
