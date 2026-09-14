import type { SearchResult } from "@personal-os/schema";
import type { Href } from "expo-router";

// Where a tapped search result goes.
//
// ===========================================================================
// A DESTINATION IS DERIVED FROM TRUSTED FIELDS ONLY
// ===========================================================================
//
// Every input to this function is server-authored: a `type` from a closed
// discriminated union, and a uuid. No title, preview, subject or sender name is
// consulted, and the API deliberately returns no href for the client to follow.
// That is the whole defence: a mail subject or an inbox capture can contain any
// text at all, including something URL-shaped, and none of it can influence
// where a tap lands.
//
// Lives in src/utils rather than beside the screen because src/app is
// routes-only -- a colocated test file there would register a bogus route and
// break `expo export --platform web` (src/__tests__/routes-hygiene.test.ts).

/**
 * How the six searchable types map onto screens that actually exist.
 *
 * The switch is exhaustive over the discriminated union with no default: a
 * seventh member added to SearchResultTypeSchema is a TypeScript error here,
 * not a result that silently renders as a dead row.
 */
export function searchResultHref(result: SearchResult): Href | null {
  switch (result.type) {
    case "task":
      return `/tasks/${result.id}` as Href;
    case "note":
      return `/notes/${result.id}` as Href;
    case "event":
      // A search result is one row -- a series parent, a one-off or a detached
      // instance -- so the plain detail route, never the `?occursAt=` form
      // Today and the Agenda use for a materialized instance
      // (utils/event-navigation.ts). An external event lands on the read-only
      // card (ADR-064).
      return `/events/${result.id}` as Href;
    case "project":
      return `/projects/${result.id}` as Href;
    case "inbox_item":
      // When the capture was committed to an entity, that entity is the useful
      // destination; otherwise the capture's own detail screen (Checkpoint 9.3),
      // where it can be filed or dismissed.
      if (result.entity_id !== null) {
        switch (result.entity_type) {
          case "task":
            return `/tasks/${result.entity_id}` as Href;
          case "note":
            return `/notes/${result.entity_id}` as Href;
          case "event":
            return `/events/${result.entity_id}` as Href;
          default:
            break;
        }
      }
      return `/inbox/${result.id}` as Href;
    case "mail_message":
      // No per-message screen exists, and ADR-052 forbids the app acting on
      // mail, so there is nothing to navigate to. Null means "render this row
      // as non-interactive" rather than "navigate somewhere plausible".
      return null;
  }
}

/** Section headings, keyed by type; SEARCH_RESULT_TYPE_ORDER fixes their order. */
export const SEARCH_TYPE_LABELS: Record<SearchResult["type"], string> = {
  task: "Tasks",
  note: "Notes",
  event: "Events",
  project: "Projects",
  inbox_item: "Inbox",
  mail_message: "Mail",
};

/**
 * The short chip a single row wears so a mixed "Top matches" list stays
 * legible. Singular, because it labels one item.
 */
export const SEARCH_TYPE_CHIP_LABELS: Record<SearchResult["type"], string> = {
  task: "Task",
  note: "Note",
  event: "Event",
  project: "Project",
  inbox_item: "Inbox",
  mail_message: "Mail",
};
