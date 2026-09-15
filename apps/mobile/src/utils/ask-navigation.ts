import type { AskSource } from "@personal-os/schema";
import type { Href } from "expo-router";
import { eventDetailHref } from "./event-navigation";

// Where a tapped Ask source navigates (Checkpoint 8.6B; widened in 9.7).
//
// Mirrors `search-navigation.ts`'s `searchResultHref` EXACTLY in principle,
// for the identical reason: every input here is server-authored -- the closed
// `type` union (`AskSourceTypeSchema`), a uuid, and for an event instance the
// server-formatted `occurs_at` -- and `title`/`detail` are never consulted.
// The model that produced the answer was never even given these ids (see
// apps/api/src/ask/prompt.ts); they are attached server-side, after the fact,
// from the same selection the prompt was built from.
//
// An event source may be a materialized INSTANCE of a series (the Today
// context lists instances, as the Today screen does), so it takes the
// `?occursAt=` form through the same helper Today and the Agenda use --
// otherwise the detail screen could not offer "this occurrence" actions on it.
// An inbox source always lands on the capture's own screen (`/inbox/:id`):
// unlike a search result, an Ask source carries no committed-entity fields, and
// guessing one would be navigation derived from something other than the
// closed contract.
export function askSourceHref(source: AskSource): Href {
  switch (source.type) {
    case "task":
      return `/tasks/${source.id}` as Href;
    case "note":
      return `/notes/${source.id}` as Href;
    case "event":
      return eventDetailHref(source.id, source.occurs_at ?? null) as Href;
    case "inbox_item":
      return `/inbox/${source.id}` as Href;
    case "project":
      return `/projects/${source.id}` as Href;
  }
}
