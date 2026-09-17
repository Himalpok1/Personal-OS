// The at-a-glance row at the top of Settings' Integrations section
// (Checkpoint 10.6): four StatusChips, one per integration, derived by the
// pure integration-summary.ts from the SAME queries the four cards below it
// already run (TanStack dedupes on the key, so this adds no request). One
// labelled card, spoken as a single group; a chip whose integration is still
// on its first load is a chip-shaped skeleton, so the row keeps its shape
// while the cards fill in.
import { View } from "react-native";
import { resolveOverallCanvasState } from "@/components/canvas/connection-state";
import {
  resolveHealthConnectionState,
  type HealthConnectionDisplayState,
} from "@/components/health/connection-state";
import { resolveOverallMailState } from "@/components/mail/connection-state";
import { Card, Skeleton, StatusChip } from "@/components/ui";
import { useCalendarConnections } from "@/queries/calendar-connections";
import { useCanvasConnections } from "@/queries/canvas";
import { useHealthSummary } from "@/queries/health";
import { useMailConnections } from "@/queries/mail";
import {
  integrationChipLabel,
  resolveOverallCalendarState,
  summarizeIntegrations,
} from "./integration-summary";

export function IntegrationSummaryRow() {
  const calendar = useCalendarConnections();
  const mail = useMailConnections();
  const health = useHealthSummary();
  const canvas = useCanvasConnections();

  // Each state is derived exactly as its card derives it (settings.tsx), so
  // the chip and the card header can never disagree.
  const calendarState = calendar.isLoading
    ? null
    : resolveOverallCalendarState({
        connections: calendar.data?.items ?? [],
        isLoadError: calendar.isError,
      });
  const mailState = mail.isLoading
    ? null
    : resolveOverallMailState({
        configured: mail.data?.configured ?? false,
        connections: mail.data?.items ?? [],
        isLoadError: mail.isError,
      });
  const healthState: HealthConnectionDisplayState | null = health.isError
    ? "unavailable"
    : health.data
      ? resolveHealthConnectionState({
          configured: health.data.configured,
          connection: health.data.connection,
          freshness: health.data.freshness,
          isLoadError: false,
        })
      : null;
  const canvasState = canvas.isLoading
    ? null
    : resolveOverallCanvasState({
        configured: canvas.data?.configured ?? false,
        connections: canvas.data?.items ?? [],
        isLoadError: canvas.isError,
      });

  const items = summarizeIntegrations({
    calendar: calendarState,
    mail: mailState,
    health: healthState,
    canvas: canvasState,
  });
  const spoken = `Integrations: ${items
    .map((item) => (item.state === null ? `${item.label} loading` : integrationChipLabel(item)))
    .join(", ")}`;

  return (
    <Card padding="sm" className="mb-4" accessibilityLabel={spoken}>
      <View className="flex-row flex-wrap gap-2">
        {items.map((item) =>
          item.state === null ? (
            <Skeleton key={item.key} width={96} height={22} rounded="full" />
          ) : (
            <StatusChip
              key={item.key}
              label={integrationChipLabel(item)}
              tone={item.tone}
              dot
              accessibilityLabel={integrationChipLabel(item)}
            />
          ),
        )}
      </View>
    </Card>
  );
}
