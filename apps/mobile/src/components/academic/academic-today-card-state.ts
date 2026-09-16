import type { AcademicAssignment, AcademicTodayResponse } from "@personal-os/schema";

// Pure, React-free rendering rules for the Today "Academics" card
// (Checkpoint 10.2, ADR-070) -- the same split as mail/digest-card-state.ts:
// the decision of WHAT the card shows is tested here as data, and
// academic-today-card.tsx only lays it out.

/** At most this many rows per section on Today -- the headline-count discipline HealthTodayCard applies. */
export const MAX_ROWS_PER_SECTION = 3;

export type AcademicSectionKey = "overdue" | "due_today" | "due_this_week";
export type AcademicSectionTone = "red" | "blue" | "neutral";

/**
 * The three assignment sections, in render order. Tones mirror the Today
 * screen's own Overdue (red) / Due today (blue) / Upcoming (neutral) headers
 * so the card reads as part of the same page.
 */
export const ACADEMIC_SECTIONS: readonly {
  key: AcademicSectionKey;
  title: string;
  tone: AcademicSectionTone;
}[] = [
  { key: "overdue", title: "Overdue", tone: "red" },
  { key: "due_today", title: "Due today", tone: "blue" },
  { key: "due_this_week", title: "Due this week", tone: "neutral" },
];

export interface VisibleAcademicSection {
  key: AcademicSectionKey;
  title: string;
  tone: AcademicSectionTone;
  /** The server's honest total for the section, shown in the header. */
  total: number;
  /** The rows actually rendered: the first MAX_ROWS_PER_SECTION items. */
  rows: AcademicAssignment[];
  /** `total - rows.length` when positive -- the "+N more" line -- else 0. */
  hiddenCount: number;
}

/**
 * Which sections render, and with what. A section is shown only when the
 * server reports something in it (by `total` OR by a non-empty `items`, so a
 * contract regression in either direction still shows rather than hides).
 * Rows are the server's own order, capped; the total is never recomputed
 * from the capped list.
 */
export function visibleAcademicSections(data: AcademicTodayResponse): VisibleAcademicSection[] {
  const out: VisibleAcademicSection[] = [];
  for (const section of ACADEMIC_SECTIONS) {
    const { items, total } = data[section.key];
    if (total <= 0 && items.length === 0) continue;
    const rows = items.slice(0, MAX_ROWS_PER_SECTION);
    out.push({
      key: section.key,
      title: section.title,
      tone: section.tone,
      total,
      rows,
      hiddenCount: Math.max(0, total - rows.length),
    });
  }
  return out;
}

/**
 * The card's whole posture in one predicate. It renders NOTHING -- not an
 * empty state -- when the server is not configured for academics or when
 * there is nothing it would actually show: no assignment section and no
 * unread announcement. `events` and read announcements are deliberately not
 * considered, because the card never renders them; a card consisting of a
 * header and nothing else would be clutter on the busiest screen in the app.
 */
export function shouldRenderAcademicCard(data: AcademicTodayResponse): boolean {
  if (!data.configured) return false;
  return visibleAcademicSections(data).length > 0 || data.summary.unread_announcements_total > 0;
}
