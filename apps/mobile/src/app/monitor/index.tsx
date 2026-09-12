import type { MonitorIncident, MonitorTargetStatus } from "@personal-os/schema";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { confirmDestructive } from "@/components/confirm-destructive";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
import {
  describeLastCheck,
  describeMonitorSummary,
  monitorStateText,
  skippedReasonText,
  monitorStateToneClass,
  resolveMonitorTargetState,
} from "@/components/monitor/target-state";
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

const CARD_CLASS = "mx-4 mb-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";

function SectionHeader({ title }: { title: string }) {
  return (
    <View className="px-4 pb-2 pt-5">
      <Text className="text-sm font-semibold uppercase text-neutral-500 dark:text-neutral-400">
        {title}
      </Text>
    </View>
  );
}

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

  return (
    <Pressable
      // `as Href`: expo-router's typed routes are generated from the route
      // tree and the generated declaration lags a newly added screen -- same
      // escape hatch, for the same reason, as MONITOR_ROUTE in settings.tsx.
      onPress={() => router.push(`/monitor/${status.target.id}` as Href)}
      accessibilityRole="button"
      accessibilityLabel={`View configuration for ${status.target.name}`}
      className={CARD_CLASS}
    >
      <Text className="text-base font-medium text-black dark:text-white">
        {status.target.name}
      </Text>

      <Text className={`mt-1 text-sm ${monitorStateToneClass(view.state)}`}>
        {monitorStateText(view.state, status.target.kind)}
      </Text>

      {/* Names WHICH reason the skip row carries, in the past tense the row
          supports -- the card never asserts a maintenance window is open now. */}
      {skippedReasonText(status) === null ? null : (
        <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {skippedReasonText(status)}
        </Text>
      )}

      {/* Reserved height so the card cannot jump between "checked" and not. */}
      <Text className="min-h-[16px] text-xs text-neutral-500 dark:text-neutral-400">
        {lastCheck ?? ""}
      </Text>

      {/* The URL is shown deliberately -- a monitoring view that cannot say
          WHICH endpoint is down is not worth having. A probe error's TEXT is
          never shown, and there is no field carrying one. */}
      {status.target.url === null ? null : (
        <Text
          numberOfLines={1}
          className="mt-1 text-xs text-neutral-400 dark:text-neutral-500"
        >
          {status.target.url}
        </Text>
      )}

      {status.latest_check?.tls_days_remaining === null ||
      status.latest_check?.tls_days_remaining === undefined ? null : (
        <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {`Certificate expires in ${status.latest_check.tls_days_remaining} day${
            status.latest_check.tls_days_remaining === 1 ? "" : "s"
          }`}
        </Text>
      )}

      {view.incidentId === null || acknowledged ? null : (
        <Pressable
          onPress={(e) => {
            // Stops propagation so this does not ALSO trigger the card's own
            // navigate-to-detail onPress -- same precedent as
            // apps/mobile/src/app/tasks/index.tsx's row action buttons.
            e.stopPropagation();
            onAcknowledge(view.incidentId!, status.target.name);
          }}
          disabled={isAcknowledging}
          accessibilityRole="button"
          accessibilityState={{ disabled: isAcknowledging }}
          accessibilityLabel={`Acknowledge the incident for ${status.target.name}`}
          hitSlop={8}
          className="mt-3 min-h-[44px] items-center justify-center self-start rounded-lg bg-amber-600 px-4 py-2 active:opacity-70"
        >
          <Text className="text-sm font-medium text-white">
            {isAcknowledging ? "Acknowledging…" : "Acknowledge"}
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
}

function IncidentRow({ incident, targetName }: { incident: MonitorIncident; targetName: string }) {
  const resolved = incident.resolved_at !== null;
  return (
    <View className={CARD_CLASS}>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium text-black dark:text-white">{targetName}</Text>
        <Text
          className={`text-xs ${
            resolved
              ? "text-neutral-500 dark:text-neutral-400"
              : incident.status === "acknowledged"
                ? "text-amber-700 dark:text-amber-300"
                : "text-red-600 dark:text-red-400"
          }`}
        >
          {resolved ? "Resolved" : incident.status === "acknowledged" ? "Acknowledged" : "Open"}
        </Text>
      </View>
      <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {`Opened ${formatOpenedAt(incident.opened_at)}`}
      </Text>
      {/* A failure CLASS -- a machine token from a constrained shape -- never a
          provider message. There is no message to show: probe errors are
          reduced to tokens before they are stored. */}
      {incident.failure_class === null ? null : (
        <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {incident.failure_class}
        </Text>
      )}
    </View>
  );
}

export default function MonitorScreen() {
  const router = useRouter();
  const overview = useMonitorOverview();
  const incidents = useMonitorIncidents(false);
  const acknowledge = useAcknowledgeMonitorIncident();
  const [ackError, setAckError] = useState<string | null>(null);
  const now = Date.now();

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
      <ScrollView className="flex-1 bg-white dark:bg-black">
        <View className={CARD_CLASS}>
          {/* We could not read it, so we assert nothing about the services. */}
          <Text className="text-sm text-red-600 dark:text-red-400">
            {"Couldn't load monitoring."}
          </Text>
          <Pressable
            onPress={() => void overview.refetch()}
            accessibilityRole="button"
            hitSlop={8}
            className="mt-3 min-h-[44px] items-center justify-center self-start rounded-lg bg-blue-600 px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-white">Retry</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  if (overview.isLoading || !overview.data) {
    return (
      <ScrollView className="flex-1 bg-white dark:bg-black">
        <View className={CARD_CLASS}>
          <Text className="text-sm text-neutral-500 dark:text-neutral-400">Loading monitoring…</Text>
        </View>
      </ScrollView>
    );
  }

  const { configured, items, active_incident_count } = overview.data;

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName={FLOATING_CLEARANCE}
    >
      <View className="px-4 pt-4">
        <View className="flex-row items-center justify-between gap-2">
          <Text
            className={`flex-1 text-base ${
              active_incident_count > 0
                ? "text-red-600 dark:text-red-400"
                : "text-black dark:text-white"
            }`}
          >
            {describeMonitorSummary(configured, active_incident_count)}
          </Text>
          <Pressable
            onPress={() => router.push("/monitor/new" as Href)}
            accessibilityRole="button"
            accessibilityLabel="Add a monitor target"
            hitSlop={8}
            className="min-h-[44px] items-center justify-center rounded-lg bg-blue-600 px-3 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-white">+ Add</Text>
          </Pressable>
        </View>
        {/* Latched until the next attempt. Without it an acknowledge failure is
            completely silent and the user believes it worked. */}
        {ackError === null ? null : (
          <Text className="mt-2 text-sm text-red-600 dark:text-red-400">{ackError}</Text>
        )}
      </View>

      {!configured ? (
        <View className={`${CARD_CLASS} mt-3`}>
          {/* NOT a clean bill of health. An unseeded deployment is not being
              monitored, and saying anything reassuring here would be the
              strongest possible claim from the weakest possible evidence. */}
          <Text className="text-sm text-neutral-600 dark:text-neutral-400">
            No targets have been set up on this server yet, so nothing is being checked. Targets are
            configured on the server.
          </Text>
        </View>
      ) : (
        <>
          <SectionHeader title="Targets" />
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

      <SectionHeader title="Incidents" />
      {incidents.isError ? (
        <View className={CARD_CLASS}>
          <Text className="text-sm text-red-600 dark:text-red-400">
            {"Couldn't load incident history."}
          </Text>
          <Pressable
            onPress={() => void incidents.refetch()}
            accessibilityRole="button"
            hitSlop={8}
            className="mt-3 min-h-[44px] items-center justify-center self-start rounded-lg bg-blue-600 px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-white">Retry</Text>
          </Pressable>
        </View>
      ) : incidents.isLoading || !incidents.data ? (
        // NOT "no incidents". `incidents.data` is undefined during the first
        // fetch and through TanStack's retry backoff, and rendering that as
        // "none recorded" turns an absence of data into a positive claim -- the
        // exact failure this screen's empty states exist to avoid.
        <View className={CARD_CLASS}>
          <Text className="text-sm text-neutral-500 dark:text-neutral-400">
            Loading incidents…
          </Text>
        </View>
      ) : incidents.data.items.length === 0 ? (
        <View className={CARD_CLASS}>
          <Text className="text-sm text-neutral-500 dark:text-neutral-400">
            {configured
              ? "No incidents have been recorded."
              : "No incidents, because nothing is being checked yet."}
          </Text>
        </View>
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
            <Text className="px-4 pb-2 text-xs text-neutral-500 dark:text-neutral-400">
              {`Showing ${incidents.data!.items.length} of ${incidents.data!.total}`}
            </Text>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
