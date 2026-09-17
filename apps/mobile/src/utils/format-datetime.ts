// A short instant (timestamptz) formatter -- "Sep 22, 14:30" in the device's
// own locale -- for the many places this screen family shows a plain "when
// did this happen" line (a due instant, last activity, a captured-at). Moved
// out of projects/[id].tsx (Checkpoint 10.5) so its two new Related
// Captures/Recent Activity sections could reuse it rather than growing a
// second near-identical copy -- the same duplication utils/local-date.ts's
// own header records fixing once already, for the date-only sibling of this
// value.
//
// Deliberately separate from utils/local-date.ts: that module is
// specifically about DATE-ONLY (`YYYY-MM-DD`) values that must never
// round-trip through a UTC instant. This formats a real instant, the
// opposite category that file's header warns against conflating.
export function formatShortDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
