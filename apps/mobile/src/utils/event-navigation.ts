// The one place that derives an event's detail route from its list-row data
// (Checkpoint 9.5). Both Today and the Agenda render recurring instances, and
// the detail screen needs the instance's `occurs_at` to offer "Edit this
// occurrence" / "Cancel this occurrence" -- the Agenda passed it since Phase 4
// and Today never did, so the same instance opened two different screens.
//
// Route text is built from the server-authored id and instant only; no
// event title, location or description can reach a URL through here.

export function eventDetailHref(id: string, occursAt: string | null | undefined): string {
  return occursAt ? `/events/${id}?occursAt=${encodeURIComponent(occursAt)}` : `/events/${id}`;
}
