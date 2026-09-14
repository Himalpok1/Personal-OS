// Pure comparison of a task's recurrence-relevant state before and after a
// PATCH (Checkpoint 9.4). PATCH /tasks/:id's due_date -> due_date branch used
// to delete every future scheduled occurrence and re-expand the window on
// EVERY edit -- a title change, a priority change, a client re-sending the
// rule it had just loaded -- which churned occurrence ids the client was
// holding and, since 9.4, would have thrown away any snooze on those rows.
// The route now skips the delete + re-expand entirely when nothing here
// differs. The comparison is on NORMALISED values so a client that
// round-trips `FREQ=DAILY` as `FREQ=DAILY;INTERVAL=1` (the editor's serialiser
// emits the explicit interval; the parser's rules omit it) or re-orders the
// parts is recognised as "unchanged". No rrule library is involved: the
// normalisation is lexical, which is enough to catch the two round-trip
// shapes that exist in this codebase, and a false "changed" only costs a
// regeneration -- it can never lose data, because done/skipped rows are
// preserved by the regeneration itself.

export interface RecurrenceState {
  rrule: string | null;
  recurrenceTimezone: string | null;
  recurrenceAnchor: "due_date" | "completion_date" | null;
  recurrenceUntil: Date | null;
  recurrenceCount: number | null;
  recurrenceExdates: string[] | null;
  /** The series anchor -- compared as an instant. */
  dueAt: Date | null;
}

/**
 * Canonical form of an RRULE string for equality only (never for
 * expansion): optional `RRULE:` prefix dropped, parts upper-cased in their
 * keys, `INTERVAL=1` removed (it is the default), empty parts dropped, then
 * sorted case-insensitively. Returns null for null/blank input.
 */
export function normalizeRrule(rrule: string | null | undefined): string | null {
  if (rrule === null || rrule === undefined) return null;
  const trimmed = rrule.trim().replace(/^RRULE:/i, "");
  if (trimmed === "") return null;
  const parts = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) return part.toUpperCase();
      return `${part.slice(0, eqIdx).trim().toUpperCase()}=${part.slice(eqIdx + 1).trim()}`;
    })
    .filter((part) => part.toUpperCase() !== "INTERVAL=1");
  parts.sort((a, b) => {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
  return parts.join(";");
}

function instantOrNull(value: Date | null): number | null {
  return value === null ? null : value.getTime();
}

function sameExdates(a: string[] | null, b: string[] | null): boolean {
  const left = a === null || a.length === 0 ? null : [...a].sort();
  const right = b === null || b.length === 0 ? null : [...b].sort();
  if (left === null || right === null) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** True when any recurrence-relevant field differs after normalisation. */
export function recurrenceChanged(existing: RecurrenceState, next: RecurrenceState): boolean {
  if (normalizeRrule(existing.rrule) !== normalizeRrule(next.rrule)) return true;
  if (existing.recurrenceTimezone !== next.recurrenceTimezone) return true;
  if ((existing.recurrenceAnchor ?? "due_date") !== (next.recurrenceAnchor ?? "due_date")) {
    return true;
  }
  if (instantOrNull(existing.recurrenceUntil) !== instantOrNull(next.recurrenceUntil)) return true;
  if (existing.recurrenceCount !== next.recurrenceCount) return true;
  if (!sameExdates(existing.recurrenceExdates, next.recurrenceExdates)) return true;
  if (instantOrNull(existing.dueAt) !== instantOrNull(next.dueAt)) return true;
  return false;
}
