import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useDeviceIdentity } from "@/device-identity/provider";
import { api } from "@/queries/client";
import { useTasks } from "@/queries/tasks";
import { ensureNotificationPermission, ensureReminderChannel } from "./channel";
import { applyReminderReconciliation } from "./scheduler";

// Mounted once in the root layout. Re-runs whenever the active/inbox task
// list changes -- which is every time, since every task mutation
// (create/update/complete/drop/archive) already invalidates the ["tasks"]
// query key (see queries/tasks.ts), so this hook needs no extra wiring
// beyond subscribing to the same query every other screen already uses.
//
// "Only the primary reminder device schedules reminders" (per
// docs/ARCHITECTURE.md's notification routing table): every device syncs
// task data, but only the one marked is_primary_reminder_device ever calls
// expo-notifications' scheduling API.
export function useReminderReconciliation(): void {
  const { identity } = useDeviceIdentity();

  const { data: device } = useQuery({
    queryKey: ["devices", "self", identity?.deviceId],
    queryFn: () => api.getDevice(identity!.token, identity!.deviceId),
    enabled: identity !== null,
    // last_seen_at is diagnostic only (see docs/ARCHITECTURE.md) but this
    // read still shouldn't go stale for minutes at a time -- primary
    // status can change from the settings screen on another device.
    staleTime: 30_000,
  });

  const { data: tasksPage } = useTasks({ status: ["inbox", "active"], limit: 200 });

  const channelReady = useRef(false);

  useEffect(() => {
    if (device?.is_primary_reminder_device !== true) return;
    if (!tasksPage) return;

    let cancelled = false;
    void (async () => {
      if (!channelReady.current) {
        await ensureReminderChannel();
        await ensureNotificationPermission();
        channelReady.current = true;
      }
      if (cancelled) return;
      await applyReminderReconciliation(tasksPage.items);
    })();

    return () => {
      cancelled = true;
    };
  }, [device?.is_primary_reminder_device, tasksPage]);
}
