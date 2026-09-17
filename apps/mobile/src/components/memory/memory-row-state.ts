import { MEMORY_KINDS, type MemoryItem, type MemoryKind } from "@personal-os/schema";
import type { IconName } from "@/components/ui/icon";
import type { TrailingChip } from "@/components/ui/list-row";
import type { ChipTone } from "@/components/ui/status-chip";

// Pure presentation decisions for a memory row and the Memory Center hero
// (Checkpoint 10.7, ADR-077). Every function here is a plain mapping over
// the wire item -- no clock read, no fetch, no inference -- so the screens
// stay thin and the vocabulary is pinned by memory-row-state.test.ts.
//
// The "why" a memory exists is answered from its own row (ADR-077 §3):
// kind, source, created_at, updated_at. This module turns those four
// columns into the words a row shows and speaks; it never composes anything
// the row does not already carry.

export interface MemoryKindPresentation {
  label: string;
  plural: string;
  icon: IconName;
  tone: ChipTone;
}

/** Kind → the icon disc, chip tone and words, in the Memory Center's display order. */
export const MEMORY_KIND_PRESENTATION: Record<MemoryKind, MemoryKindPresentation> = {
  preference: {
    label: "Preference",
    plural: "Preferences",
    icon: "heart-outline",
    tone: "primary",
  },
  goal: { label: "Goal", plural: "Goals", icon: "flag-outline", tone: "success" },
  fact: { label: "Fact", plural: "Facts", icon: "information-outline", tone: "info" },
};

/** The display order of the kind sections: Preferences, then Goals, then Facts. */
export const MEMORY_KIND_ORDER: readonly MemoryKind[] = MEMORY_KINDS;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** The device-local civil day of an instant, as plain numbers. */
function localDay(iso: string): { year: number; month: number; day: number } {
  const date = new Date(iso);
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

/** "17 Sep 2026" -- the instant's device-local day. */
export function formatMemoryDate(iso: string): string {
  const { year, month, day } = localDay(iso);
  return `${day} ${MONTHS_SHORT[month]} ${year}`;
}

/** "17 September" -- for the spoken summary; the year is noise when read aloud. */
export function formatMemoryDateSpoken(iso: string): string {
  const { month, day } = localDay(iso);
  return `${day} ${MONTHS_LONG[month]}`;
}

/** True when the two instants fall on different device-local days. */
export function isDifferentLocalDay(a: string, b: string): boolean {
  const x = localDay(a);
  const y = localDay(b);
  return x.year !== y.year || x.month !== y.month || x.day !== y.day;
}

/** "Added by you" / "From a suggestion" -- the provenance word for a source. */
export function memorySourceWord(source: MemoryItem["source"]): string {
  return source === "suggestion" ? "From a suggestion" : "Added by you";
}

/**
 * The row's subtitle: provenance, the created day, and -- only when the row
 * was edited on a later day -- when. "Added by you · 17 Sep 2026 · edited
 * 18 Sep" (the edit's year is added only if it differs from the created one).
 */
export function memorySourceLine(
  memory: Pick<MemoryItem, "source" | "created_at" | "updated_at">,
): string {
  const parts = [memorySourceWord(memory.source), formatMemoryDate(memory.created_at)];
  if (isDifferentLocalDay(memory.created_at, memory.updated_at)) {
    const created = localDay(memory.created_at);
    const edited = localDay(memory.updated_at);
    const editedLabel = `${edited.day} ${MONTHS_SHORT[edited.month]}${
      edited.year === created.year ? "" : ` ${edited.year}`
    }`;
    parts.push(`edited ${editedLabel}`);
  }
  return parts.join(" · ");
}

/** The one linked name a row shows as a chip: the project first, else the course, else none. */
export function memoryLinkChip(
  memory: Pick<MemoryItem, "project" | "course">,
): TrailingChip | null {
  if (memory.project) return { label: memory.project.name, tone: "neutral" };
  if (memory.course) {
    const code = memory.course.course_code?.trim() ?? "";
    return { label: code.length > 0 ? code : memory.course.name, tone: "neutral" };
  }
  return null;
}

/** One spoken summary per row: kind, statement, provenance and day, then the link. */
export function memoryRowSpoken(memory: MemoryItem): string {
  const kind = MEMORY_KIND_PRESENTATION[memory.kind].label;
  const link = memoryLinkChip(memory);
  return [
    `${kind}: ${memory.statement}`,
    `${memorySourceWord(memory.source)} ${formatMemoryDateSpoken(memory.created_at)}`,
    link ? `Linked to ${link.label}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(". ");
}

/** "Personal OS remembers nothing yet" / "… 1 thing" / "… 3 things". */
export function memoryHeroHeadline(count: number): string {
  if (count <= 0) return "Personal OS remembers nothing yet";
  return `Personal OS remembers ${count} ${count === 1 ? "thing" : "things"}`;
}

export interface MemoryKindGroup {
  kind: MemoryKind;
  presentation: MemoryKindPresentation;
  items: MemoryItem[];
}

/** The list partitioned by kind, in display order, keeping the server's order within a kind. */
export function groupMemoriesByKind(items: readonly MemoryItem[]): MemoryKindGroup[] {
  return MEMORY_KIND_ORDER.map((kind) => ({
    kind,
    presentation: MEMORY_KIND_PRESENTATION[kind],
    items: items.filter((item) => item.kind === kind),
  }));
}

/** Per-kind counts for the hero's inline strip, in display order. */
export function memoryKindCounts(
  items: readonly MemoryItem[],
): { kind: MemoryKind; count: number }[] {
  return MEMORY_KIND_ORDER.map((kind) => ({
    kind,
    count: items.filter((item) => item.kind === kind).length,
  }));
}
