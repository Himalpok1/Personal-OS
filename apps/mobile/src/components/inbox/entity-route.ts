import type { InboxItem } from "@personal-os/schema";

// Where an inbox item's committed entity lives.
//
// ===========================================================================
// A DESTINATION IS DERIVED FROM SERVER-AUTHORED FIELDS ONLY
// ===========================================================================
//
// `entity_type` is a closed enum and `entity_id` a uuid, both written by the
// worker when it commits the parsed entity (apps/worker/src/commit-parsed-
// entity.ts). Neither `raw_text` nor anything inside `parse_result` is
// consulted, and the API returns no href: a capture that LOOKS like a path
// ("/tasks/../settings", a URL pasted from a share sheet) cannot become one.
// Same rule as utils/search-navigation.ts (Checkpoint 8.3, ADR-059 §6).
//
// Typed as a literal union rather than `string` -- the same choice
// notifications/resolve-notification-route.ts makes -- so expo-router's typed
// `Href` accepts it at the call site while this module imports nothing from
// expo-router and stays a plain vitest unit.
export type EntityRoute = `/tasks/${string}` | `/notes/${string}` | `/events/${string}`;

/**
 * Null when the item has not been committed to anything yet (no `entity_id`),
 * or when the two fields disagree (a type with no id, or an id with no type):
 * a half-written pair is not a destination.
 */
export function entityRoute(
  item: Pick<InboxItem, "entity_type" | "entity_id">,
): EntityRoute | null {
  const id = item.entity_id;
  if (id === null || id.length === 0) return null;
  switch (item.entity_type) {
    case "task":
      return `/tasks/${id}`;
    case "note":
      return `/notes/${id}`;
    case "event":
      return `/events/${id}`;
    case null:
      return null;
  }
}
