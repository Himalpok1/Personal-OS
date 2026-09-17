import type {
  AcademicAssignment,
  AcademicPriorityItem,
  AcademicTodayResponse,
} from "@personal-os/schema";
import { workloadNeedsAttention } from "./workload-state";

// Pure, React-free rendering rules for the Today "Academics" card
// (Checkpoint 10.2, ADR-070; Checkpoint 10.3 adds the intelligence keys) --
// the same split as mail/digest-card-state.ts: the decision of WHAT the card
// shows is tested here as data, and academic-today-card.tsx only lays it out.
//
// The 10.3 keys (`priorities`, `workload`, `course_attention`) are OPTIONAL
// on the wire so the versionCode-25 client keeps parsing; every rule below
// treats an absent key as "nothing to show" rather than as an error.

/** At most this many rows per section on Today -- the headline-count discipline HealthTodayCard applies. */
export const MAX_ROWS_PER_SECTION = 3;

/** At most this many "Do next" rows -- the top of the server's ranked list. */
export const MAX_PRIORITY_ROWS = 3;

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
 *
 * `alreadyShown` -- the ids the "Do next" block renders above these sections.
 * The server's priority candidates are exactly the union of the three
 * buckets (every open, dated assignment before the horizon), so without this
 * the card listed the same assignment twice on a 480 × 640 screen. A row
 * already in "Do next" is skipped here; the header keeps the server's honest
 * total; `hiddenCount` counts only what is on neither list; and a section
 * whose every row is already above renders nothing rather than a bare
 * header.
 */
export function visibleAcademicSections(
  data: AcademicTodayResponse,
  alreadyShown: ReadonlySet<string> = new Set(),
): VisibleAcademicSection[] {
  const out: VisibleAcademicSection[] = [];
  for (const section of ACADEMIC_SECTIONS) {
    const { items, total } = data[section.key];
    if (total <= 0 && items.length === 0) continue;
    const shownHere = items.filter((item) => alreadyShown.has(item.id)).length;
    const remaining = items.filter((item) => !alreadyShown.has(item.id));
    if (remaining.length === 0 && shownHere > 0) continue;
    const rows = remaining.slice(0, MAX_ROWS_PER_SECTION);
    out.push({
      key: section.key,
      title: section.title,
      tone: section.tone,
      total,
      rows,
      hiddenCount: Math.max(0, total - shownHere - rows.length),
    });
  }
  return out;
}

export interface VisiblePriorities {
  /** The server's honest total of ranked candidates. */
  total: number;
  /** The first MAX_PRIORITY_ROWS items, in the server's own rank order. */
  rows: AcademicPriorityItem[];
  /** `total - rows.length` when positive -- the "+N more" line -- else 0. */
  hiddenCount: number;
}

/**
 * The "Do next" block: the top of the server's ranked priority list, capped,
 * never re-sorted. Null when the key is absent (an older server) or the
 * list is empty by total AND by items -- the same either-direction rule the
 * sections use.
 */
export function visiblePriorities(data: AcademicTodayResponse): VisiblePriorities | null {
  const priorities = data.priorities;
  if (priorities === undefined) return null;
  if (priorities.total <= 0 && priorities.items.length === 0) return null;
  const rows = priorities.items.slice(0, MAX_PRIORITY_ROWS);
  return {
    total: priorities.total,
    rows,
    hiddenCount: Math.max(0, priorities.total - rows.length),
  };
}

/**
 * The card's whole posture in one predicate. It renders NOTHING -- not an
 * empty state -- when the server is not configured for academics or when
 * there is nothing it would actually show: no assignment section, no ranked
 * priority, no workload status that needs acting on (`behind` / `at_risk`),
 * and no unread announcement. `events`, read announcements and an
 * `on_track` workload are deliberately not considered, because the card
 * would then consist of a header and a reassurance; on the busiest screen in
 * the app that is clutter.
 */
export function shouldRenderAcademicCard(data: AcademicTodayResponse): boolean {
  if (!data.configured) return false;
  if (visibleAcademicSections(data).length > 0) return true;
  if (data.summary.unread_announcements_total > 0) return true;
  if (visiblePriorities(data) !== null) return true;
  return data.workload !== undefined && workloadNeedsAttention(data.workload.status);
}
