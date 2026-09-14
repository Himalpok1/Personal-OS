// Which occurrence is "the next one" (Checkpoint 9.4) -- the single row the
// task detail screen's "Next: …" line, its Complete/Skip/Snooze chips and the
// reminder scheduler all act on. Kept out of the React component per
// docs/ARCHITECTURE.md ("if you find yourself putting a date calculation
// inside a React component, it belongs in core").
//
// Client-safe: no imports at all. The instants arrive as the ISO strings the
// wire schema (OccurrenceSchema) carries, and the comparison is on epoch
// milliseconds, so the device's own zone never enters into it.
//
// Semantics, aligned with the frozen Today read model (docs/ARCHITECTURE.md
// "Today & agenda read models") and the 9.4 product contract ("the current
// instance is the earliest scheduled occurrence"): only `scheduled` rows are
// candidates; a row's EFFECTIVE instant is the LATER of `occurs_at` and
// `snoozed_until` (migration 0018) -- a snooze may only DEFER an instance,
// never pull it earlier, and the server's read models apply the same
// `greatest(...)` (9.4 review; this used to be `snoozed_until ?? occurs_at`,
// which let a stale snooze instant move a row forward in time); "overdue" is
// a strict instant comparison against `now`, never end-of-day. The chosen
// row is simply the EARLIEST effective instant, overdue or not: an overdue
// instance is the one the owner has to deal with next, and preferring an
// upcoming row over it would let the detail screen act on the wrong
// occurrence while Today still lists the overdue one (9.4 review).

export interface NextOccurrenceCandidate {
  id: string;
  occurs_at: string;
  status: string;
  snoozed_until?: string | null;
}

export interface NextOccurrence {
  id: string;
  /** ISO instant the occurrence is effectively due: `max(occurs_at, snoozed_until)`. */
  effective_at: string;
  /** True when `effective_at < now`. */
  overdue: boolean;
  /** True when the effective instant comes from `snoozed_until` (a snooze that actually defers). */
  snoozed: boolean;
}

interface Ranked {
  candidate: NextOccurrenceCandidate;
  effectiveMs: number;
  snoozed: boolean;
}

function rank(item: NextOccurrenceCandidate): Ranked | null {
  if (item.status !== "scheduled") return null;
  const occursMs = new Date(item.occurs_at).getTime();
  if (Number.isNaN(occursMs)) return null;
  const snoozedMs = item.snoozed_until == null ? NaN : new Date(item.snoozed_until).getTime();
  // An unparseable snooze instant is ignored rather than poisoning the row:
  // the occurrence still exists at occurs_at.
  const snoozed = !Number.isNaN(snoozedMs) && snoozedMs > occursMs;
  return { candidate: item, effectiveMs: snoozed ? snoozedMs : occursMs, snoozed };
}

// Earliest effective instant first; `id` breaks ties so the choice is a
// total order (Checkpoint 8.2 observed rows sharing one timestamp to the
// microsecond, so ties are a real property of this database).
function earlier(a: Ranked, b: Ranked): boolean {
  if (a.effectiveMs !== b.effectiveMs) return a.effectiveMs < b.effectiveMs;
  return a.candidate.id < b.candidate.id;
}

export function selectNextOccurrence(
  items: readonly NextOccurrenceCandidate[],
  now: Date,
): NextOccurrence | null {
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) throw new Error("selectNextOccurrence: invalid `now`");

  let chosen: Ranked | null = null;
  for (const item of items) {
    const ranked = rank(item);
    if (ranked === null) continue;
    if (chosen === null || earlier(ranked, chosen)) chosen = ranked;
  }

  if (chosen === null) return null;
  return {
    id: chosen.candidate.id,
    effective_at: new Date(chosen.effectiveMs).toISOString(),
    overdue: chosen.effectiveMs < nowMs,
    snoozed: chosen.snoozed,
  };
}
