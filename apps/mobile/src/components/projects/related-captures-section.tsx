import { Fragment } from "react";
import type { ProjectContextResponse } from "@personal-os/schema";
import { AppText, Card, ListRow, SectionHeader } from "@/components/ui";
import { formatShortDateTime } from "@/utils/format-datetime";

// Captures that became one of this project's own items (Checkpoint 10.5,
// ADR-074) -- GET /projects/:id/context's own join through
// inbox_items.entity_type/entity_id, never a text match. Hook-free and
// prop-driven so it can be called directly in a test, like
// TaskAssignmentPicker/ProjectLinkRow; navigation is threaded in rather than
// calling useRouter() here.
//
// Renders NOTHING when there is nothing to show -- this app's own
// discipline for an optional section (see academic-today-card.tsx's own
// header comment on the same rule), so a project with no captures never
// grows an empty "Related Captures" header.

export interface RelatedCapturesSectionProps {
  captures: ProjectContextResponse["related_captures"];
  onOpenCapture: (id: string) => void;
}

export function RelatedCapturesSection({ captures, onOpenCapture }: RelatedCapturesSectionProps) {
  if (captures.items.length === 0) return null;
  return (
    <Fragment>
      <SectionHeader title="Related Captures" count={captures.total} />
      <Card padding="none">
        {captures.items.map((item, index) => {
          const title = item.raw_text ?? "Untitled capture";
          return (
            <ListRow
              key={item.id}
              icon="text-box-outline"
              title={title}
              meta={formatShortDateTime(item.captured_at)}
              onPress={() => onOpenCapture(item.id)}
              accessibilityLabel={`Open capture: ${title}`}
              chevron
              last={index === captures.items.length - 1}
            />
          );
        })}
        {captures.total > captures.items.length ? (
          <AppText variant="caption" tone="muted" className="px-4 py-2">
            &gt;{captures.total - captures.items.length} more
          </AppText>
        ) : null}
      </Card>
    </Fragment>
  );
}
