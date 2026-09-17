import { Fragment } from "react";
import type { ProjectContextResponse } from "@personal-os/schema";
import { AppText, Card, ListRow, SectionHeader } from "@/components/ui";
import { formatShortDateTime } from "@/utils/format-datetime";

// A small newest-first feed of what happened on this project recently
// (Checkpoint 10.5, ADR-074): task completions, note writes, occurrence
// completions. The server already wrote each `description` (GET
// /projects/:id/context) -- this renders it verbatim rather than
// re-deriving a label from `type` + a title, matching this project's
// "provider/server-authored text lands in <Text> only" discipline. Rows are
// inert (no onPress): there is no single screen a mixed-type activity entry
// opens to.
//
// Hook-free and prop-driven, like RelatedCapturesSection beside it. Renders
// nothing when there is nothing to show.

export interface RecentActivitySectionProps {
  activity: ProjectContextResponse["recent_activity"];
}

export function RecentActivitySection({ activity }: RecentActivitySectionProps) {
  if (activity.items.length === 0) return null;
  return (
    <Fragment>
      <SectionHeader title="Recent Activity" count={activity.total} />
      <Card padding="none">
        {activity.items.map((item, index) => (
          <ListRow
            key={`${item.type}-${item.at}-${index}`}
            title={item.description}
            meta={formatShortDateTime(item.at)}
            last={index === activity.items.length - 1}
          />
        ))}
        {activity.total > activity.items.length ? (
          <AppText variant="caption" tone="muted" className="px-4 py-2">
            &gt;{activity.total - activity.items.length} more
          </AppText>
        ) : null}
      </Card>
    </Fragment>
  );
}
