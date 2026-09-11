import type { AskSource } from "@personal-os/schema";
import type { Href } from "expo-router";

// Where a tapped Ask source navigates (Checkpoint 8.6B).
//
// Mirrors `search-navigation.ts`'s `searchResultHref` task/note cases
// EXACTLY, for the identical reason: every input here is server-authored --
// a closed `type` union (`AskSourceTypeSchema` admits only "task"/"note") plus
// a uuid -- and `title` is never consulted. The model that produced the
// answer was never even given these ids (see apps/api/src/ask/prompt.ts);
// they are attached server-side, after the fact, from the same selection the
// prompt was built from. So there is no mail/inbox case to reproduce here:
// Ask sources are only ever a task or a note.
export function askSourceHref(source: AskSource): Href {
  switch (source.type) {
    case "task":
      return `/tasks/${source.id}` as Href;
    case "note":
      return `/notes/${source.id}` as Href;
  }
}
