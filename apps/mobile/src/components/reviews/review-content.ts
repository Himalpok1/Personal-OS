import type { Review, ReviewPriorityRef } from "@personal-os/schema";

// Resume-persistence helpers (Checkpoint 5.3 audit D1). Content v1 carries an
// explicit `kind` discriminator and the server binds it to the row's kind on
// every PATCH, so non-null content is always trusted wholesale here — never
// narrowed by checklist key presence (checklists are sparse by design).

export function savedChecklist(
  review: Review,
): Record<string, boolean | undefined> {
  return review.content?.checklist ?? {};
}

export function savedPriorities(review: Review): ReviewPriorityRef[] {
  return review.content?.selected_priorities ?? [];
}

export function savedSummary(review: Review): string {
  return review.summary ?? "";
}

export function isCurrentPeriod(review: Review, periodStart: string): boolean {
  return review.period_start === periodStart;
}
