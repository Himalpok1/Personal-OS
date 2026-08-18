import { ApiClientError } from "@personal-os/api-client";
import type { Task } from "@personal-os/schema";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useDeviceIdentity } from "@/device-identity/provider";
import { api } from "@/queries/client";
import { ensureNotificationPermission, ensureReminderChannel } from "./channel";
import { ensureExactAlarmPermission } from "./exact-alarm";
import { applyReminderReconciliation, cancelOwnedReminders } from "./scheduler";

const REMINDER_PAGE_SIZE = 200;

async function listAllReminderTasks(): Promise<Task[]> {
  const items: Task[] = [];
  let offset = 0;

  for (;;) {
    const page = await api.listTasks({
      status: ["inbox", "active"],
      limit: REMINDER_PAGE_SIZE,
      offset,
    });
    items.push(...page.items);
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) return items;
  }
}

// Existing OS schedules remain authoritative while the API or tailnet is
// unavailable. They are cancelled only when device state authoritatively
// says this install may no longer own them.
export function useReminderReconciliation(): void {
  const { identity } = useDeviceIdentity();
  const [foregroundEpoch, setForegroundEpoch] = useState(0);
  const previousIdentity = useRef(identity);

  const deviceQuery = useQuery({
    queryKey: ["devices", "self", identity?.deviceId],
    queryFn: () => api.getDevice(identity!.token, identity!.deviceId),
    enabled: identity !== null && Platform.OS !== "web",
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", "reminders"],
    queryFn: listAllReminderTasks,
    enabled: identity !== null && Platform.OS !== "web",
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setForegroundEpoch((value) => value + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const lostIdentity = previousIdentity.current !== null && identity === null;
    previousIdentity.current = identity;
    if (lostIdentity) void cancelOwnedReminders();
  }, [identity]);

  useEffect(() => {
    if (Platform.OS === "web" || identity === null) return;

    const device = deviceQuery.data;
    const unauthorized =
      deviceQuery.error instanceof ApiClientError && deviceQuery.error.status === 401;
    const ineligible =
      unauthorized ||
      (device !== undefined &&
        (device.revoked_at !== null ||
          !device.notifications_enabled ||
          !device.is_primary_reminder_device));

    if (ineligible) {
      void cancelOwnedReminders().catch((error: unknown) => {
        console.warn("Failed to cancel local reminders for an ineligible device", error);
      });
      return;
    }

    // Generic fetch failures intentionally preserve already-scheduled
    // alarms so reminders still work while the server is unreachable.
    if (!device || !tasksQuery.data || !device.is_primary_reminder_device) return;

    let cancelled = false;
    void (async () => {
      await ensureReminderChannel();
      const permissionGranted = await ensureNotificationPermission();
      if (!permissionGranted || cancelled) return;
      // Prompts once per run when the permission is missing, then schedules
      // with whatever capability is actually available -- an inexact
      // reminder still beats no reminder.
      const exactAlarmCapable = ensureExactAlarmPermission();
      await applyReminderReconciliation(tasksQuery.data, exactAlarmCapable);
    })().catch((error: unknown) => {
      console.warn("Local reminder reconciliation failed", error);
    });

    return () => {
      cancelled = true;
    };
  }, [
    deviceQuery.data,
    deviceQuery.error,
    foregroundEpoch,
    identity,
    tasksQuery.data,
  ]);
}
