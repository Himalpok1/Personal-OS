// The Inbox tab's Open / Dismissed segment (Checkpoint 10.6).
//
// The server owns the filter -- `GET /inbox` hides dismissed (archived) rows
// unless `include_archived=true` is sent, exactly as the pre-10.6 "Show
// dismissed" toggle requested it -- so the query for each segment is the
// query that toggle sent. `include_archived=true` returns open AND dismissed
// rows together; the Dismissed segment then shows only the dismissed ones,
// keyed on the row's own `archived_at`, which is the honest reading of a
// segment named "Dismissed". Pure, so both halves are pinned by a test.
import type { InboxItem } from "@personal-os/schema";
import type { SegmentedOption } from "@/components/ui";

export type InboxSegment = "open" | "dismissed";

export const INBOX_SEGMENTS: readonly SegmentedOption<InboxSegment>[] = [
  { value: "open", label: "Open", accessibilityLabel: "Open captures" },
  { value: "dismissed", label: "Dismissed", accessibilityLabel: "Dismissed captures" },
];

/** The `useInbox` params each segment fetches with -- byte-identical to the old toggle's. */
export function inboxQueryParams(segment: InboxSegment): { include_archived?: true } {
  return segment === "dismissed" ? { include_archived: true } : {};
}

export function visibleInboxItems(items: readonly InboxItem[], segment: InboxSegment): InboxItem[] {
  if (segment === "open") return items.filter((item) => item.archived_at === null);
  return items.filter((item) => item.archived_at !== null);
}

export function inboxEmptyCopy(segment: InboxSegment): { title: string; body: string } {
  return segment === "dismissed"
    ? { title: "Nothing dismissed", body: "Captures you dismiss are kept here." }
    : { title: "Inbox is clear", body: "Captures land here until they're filed." };
}
