import type { MonitorIncident, MonitorTargetStatus } from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { confirmDestructive } from "@/components/confirm-destructive";
import {
  describeLastCheck,
  describeMonitorSummary,
  monitorStateText,
  monitorStateTone,
  skippedReasonText,
  resolveMonitorTargetState,
} from "@/components/monitor/target-state";
import {
  AppText,
  Button,
  Card,
  ErrorState,
  Screen,
  SectionHeader,
  SkeletonCard,
  StatusChip,
} from "@/components/ui";
import {
  useAcknowledgeMonitorIncident,
  useMonitorIncidents,
  useMonitorOverview,
} from "@/queries/monitor";

// The service-monitoring screen (Checkpoint 7.6, ADR-055).
//
// ===========================================================================
// IT DOES NOT CLAIM MORE THAN THE BACKEND PROVES.
// ===========================================================================
//
// There is no uptime percentage on this screen, and that is deliberate rather
// than unfinished. An uptime figure would need a window of checks to divide by,
// and the honest version of that number has THREE states -- up, down, and a
// window in which the monitor was not running -- which is exactly why
// `MonitorUptimePointSchema` carries a refine making `not_checked` with a ratio
// unrepresentable. Rendering "0%" for a gap is the specific failure that schema
// exists to prevent, and shipping a percentage before there is a read model that
// can express the third state would walk straight into it.
//
// What this screen shows is what rows prove: each target's newest check, when it
// happened, and whether an incident is open.
//
// EVERY ENVIRONMENT SHOWS THE EMPTY STATE TODAY. No monitor target has ever been
// seeded anywhere (`monitor:seed` is an operator action, not a deployment side
// effect), so "nothing is configured" is the primary case, not an edge case --
// and it must never render as a clean bill of health.

/**
 * Fixed copy for an acknowledge failure. Never the thrown error's text.
 *
 * `incident_already_resolved` is not the user's mistake -- the outage ended
 * between the list rendering and the tap -- so it gets its own sentence rather
 * than a generic apology.
 */
function describeAcknowledgeFailure(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: unknown }).code
      : undefined;
  if (code === "incident_already_resolved") return "That incident already resolved on its own.";
  if (code === "not_found") return "That incident no longer exists.";
  return "Couldn't acknowledge that incident. Try again.";
}

function formatOpenedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TargetCard({
  status,
  now,
  onAcknowledge,
  isAcknowledging,
}: {
  status: MonitorTargetStatus;
  now: number;
  onAcknowledge: (incidentId: string, targetName: string) => void;
  isAcknowledging: boolean;
}) {
  const router = useRouter();
  const view = resolveMonitorTargetState(status, now);
  const lastCheck = describeLastCheck(status, now);
  const acknowledged = status.active_incident?.status === "acknowledged";
  const tls = status.latest_check?.tls_days_remaining;

  // The body and the Acknowledge control are SIBLINGS on an inert card, not
  // nested pressables: the pre-10.3 card stopped the acknowledge tap's
  // propagation by hand (under react-native-web a nested Pressable's tap
  // bubbles to the card's own onPress), and siblings need no such guard.
  return (
    <Card padding="none" className="mb-3">
      <Pressable
        // `as Href`: expo-router's typed routes are generated from the route
        // tree and the generated declaration lags a newly added screen -- same
        // escape hatch, for the same reason, as MONITOR_ROUTE in settings.tsx.
        onPress={() => router.push(`/monitor/${status.target.id}` as Href)}
        accessibilityRole="button"
        accessibilityLabel={`View configuration for ${status.target.name}`}
        hitSlop={4}
        className="p-4 active:opacity-70"
      >
        <View className="flex-row items-start justify-between gap-2">
          <AppText variant="body-strong" className="flex-1">
            {status.target.name}
          </AppText>
          <StatusChip
            label={monitorStateText(view.state, status.target.kind)}
            tone={monitorStateTone(view.state)}
            dot
          />
        </View>

        {/* Names WHICH reason the skip row carries, in the past tense the row
            supports -- the card never asserts a maintenance window is open now. */}
        {skippedReasonText(status) === null ? null : (
          <AppText variant="caption" tone="secondary" className="mt-1">
            {skippedReasonText(status)}
          </AppText>
        )}

        {/* Reserved height so the card cannot jump between "checked" and not. */}
        <AppText variant="caption" tone="secondary" className="mt-1 min-h-[16px]">
          {lastCheck ?? ""}
        </AppText>

        {/* The URL is shown deliberately -- a monitoring view that cannot say
            WHICH endpoint is down is not worth having. A probe error's TEXT is
            never shown, and there is no field carrying one. */}
        {status.target.url === null ? null : (
          <AppText variant="caption" tone="muted" numberOfLines={1} className="mt-1">
            {status.target.url}
          </AppText>
        )}

        {tls === null || tls === undefined ? null : (
          <AppText variant="caption" tone="secondary" className="mt-1">
            {`Certificate expires in ${tls} day${tls === 1 ? "" : "s"}`}
          </AppText>
        )}
      </Pressable>

      {view.incidentId === null || acknowledged ? null : (
        <View className="px-4 pb-4">
          <Button
            label={isAcknowledging ? "Acknowledging…" : "Acknowledge"}
            onPress={() => onAcknowledge(view.incidentId!, status.target.name)}
            disabled={isAcknowledging}
            accessibilityLabel={`Acknowledge the incident for ${status.target.name}`}
            variant="tonal"
            size="sm"
            icon="bell-check-outline"
          />
        </View>
      )}
    </Card>
  );
}

function IncidentRow({ incident, targetName }: { incident: MonitorIncident; targetName: string }) {
  const resolved = incident.resolved_at !== null;
  const chip = resolved
    ? { label: "Resolved", tone: "neutral" as const }
    : incident.status === "acknowledged"
      ? { label: "Acknowledged", tone: "warning" as const }
      : { label: "Open", tone: "danger" as const };
  return (
    <Card className="mb-3">
      <View className="flex-row items-center justify-between gap-2">
        <AppText variant="body-strong" className="flex-1">
          {targetName}
        </AppText>
        <StatusChip label={chip.label} tone={chip.tone} dot />
      </View>
      <AppText variant="caption" tone="secondary" className="mt-1">
        {`Opened ${formatOpenedAt(incident.opened_at)}`}
      </AppText>
      {/* A failure CLASS -- a machine token from a constrained shape -- never a
          provider message. There is no message to show: probe errors are
          reduced to tokens before they are stored. */}
      {incident.failure_class === null ? null : (
        <AppText variant="caption" tone="muted" className="mt-1">
          {incident.failure_class}
        </AppText>
      )}
    </Card>
  );
}

export default function MonitorScreen() {
  const router = useRouter();
  const overview = useMonitorOverview();
  const incidents = useMonitorIncidents(false);
  const acknowledge = useAcknowledgeMonitorIncident();
  const [ackError, setAckError] = useState<string | null>(null);
  // The overview's own fetch instant, not a clock read in render
  // (react-hooks/purity): every "x ago" and mute-expiry reading is relative
  // to when the rows were fetched, and a refetch re-renders with a new one.
  const now = overview.dataUpdatedAt;

  const confirmAcknowledge = (incidentId: string, targetName: string): void => {
    confirmDestructive({
      title: "Acknowledge this incident?",
      // Says plainly what acknowledgement does NOT do. Treating an Ack button as
      // "make it go away" is how an outage stops being tracked while it is still
      // happening.
      message: `This records that you've seen it. ${targetName} stays marked as down until it recovers on its own.`,
      confirmLabel: "Acknowledge",
      onConfirm: () => {
        setAckError(null);
        acknowledge.mutate(incidentId, {
          // WITHOUT THIS THE FAILURE IS SILENT. The mutation defines only
          // onSuccess and there is no global mutation error handler, so a failed
          // acknowledge would leave the card unchanged and say nothing -- the
          // user would reasonably believe it worked.
          onError: (err) => setAckError(describeAcknowledgeFailure(err)),
        });
      },
    });
  };

  if (overview.isError) {
    return (
      <Screen>
        {/* We could not read it, so we assert nothing about the services. */}
        <ErrorState
          size="screen"
          message="Couldn't load monitoring."
          onRetry={() => void overview.refetch()}
          retryAccessibilityLabel="Retry loading monitoring"
        />
      </Screen>
    );
  }

  if (overview.isLoading || !overview.data) {
    return (
      <Screen>
        <SkeletonCard className="mt-4" lines={3} />
        <SkeletonCard className="mt-3" lines={3} />
      </Screen>
    );
  }

  const { configured, items, active_incident_count } = overview.data;

  return (
    <Screen
      refreshing={overview.isRefetching || incidents.isRefetching}
      onRefresh={() => {
        void overview.refetch();
        void incidents.refetch();
      }}
    >
      <View className="pt-4">
        <View className="flex-row items-center justify-between gap-2">
          <AppText
            variant="body"
            tone={active_incident_count > 0 ? "danger" : "default"}
            className="flex-1"
          >
            {describeMonitorSummary(configured, active_incident_count)}
          </AppText>
          <Button
            label="Add"
            onPress={() => router.push("/monitor/new" as Href)}
            accessibilityLabel="Add a monitor target"
            variant="primary"
            // Navigation, not an action: no haptic (components/ui/haptics.ts).
            haptic={false}
            size="sm"
            icon="plus"
          />
        </View>
        {/* Latched until the next attempt. Without it an acknowledge failure is
            completely silent and the user believes it worked. */}
        {ackError === null ? null : (
          <AppText variant="body" tone="danger" className="mt-2">
            {ackError}
          </AppText>
        )}
      </View>

      {!configured ? (
        <Card className="mt-3">
          {/* NOT a clean bill of health. An unseeded deployment is not being
              monitored, and saying anything reassuring here would be the
              strongest possible claim from the weakest possible evidence. */}
          <AppText variant="body" tone="secondary">
            No targets have been set up on this server yet, so nothing is being checked. Targets are
            configured on the server.
          </AppText>
        </Card>
      ) : (
        <>
          <SectionHeader title="Targets" count={items.length} icon="radar" />
          {items.map((item) => (
            <TargetCard
              key={item.target.id}
              status={item}
              now={now}
              onAcknowledge={confirmAcknowledge}
              isAcknowledging={acknowledge.isPending}
            />
          ))}
        </>
      )}

      <SectionHeader title="Incidents" icon="alert-outline" />
      {incidents.isError ? (
        <Card>
          <ErrorState
            message="Couldn't load incident history."
            onRetry={() => void incidents.refetch()}
            retryAccessibilityLabel="Retry loading incident history"
          />
        </Card>
      ) : incidents.isLoading || !incidents.data ? (
        // NOT "no incidents". `incidents.data` is undefined during the first
        // fetch and through TanStack's retry backoff, and rendering that as
        // "none recorded" turns an absence of data into a positive claim -- the
        // exact failure this screen's empty states exist to avoid.
        <SkeletonCard lines={2} />
      ) : incidents.data.items.length === 0 ? (
        <Card>
          <AppText variant="body" tone="secondary">
            {configured
              ? "No incidents have been recorded."
              : "No incidents, because nothing is being checked yet."}
          </AppText>
        </Card>
      ) : (
        <>
          {incidents.data?.items.map((item) => (
            <IncidentRow
              key={item.incident.id}
              incident={item.incident}
              targetName={item.target_name}
            />
          ))}
          {/* Honest totals: "showing 25 of 57" rather than implying 25 is all
              there is. */}
          {(incidents.data?.total ?? 0) > (incidents.data?.items.length ?? 0) ? (
            <AppText variant="caption" tone="muted" className="pb-2">
              {`Showing ${incidents.data!.items.length} of ${incidents.data!.total}`}
            </AppText>
          ) : null}
        </>
      )}
    </Screen>
  );
}
