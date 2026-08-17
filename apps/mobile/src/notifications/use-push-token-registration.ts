import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useDeviceIdentity } from "@/device-identity/provider";
import { api } from "@/queries/client";
import { registerForPushNotifications } from "./push-token";

export function usePushTokenRegistration(): void {
  const { identity } = useDeviceIdentity();
  const registering = useRef(false);

  const register = useCallback(async () => {
    if (Platform.OS === "web" || !identity || registering.current) return;
    registering.current = true;
    try {
      const pushToken = await registerForPushNotifications();
      await api.updateDevicePushToken(identity.token, identity.deviceId, {
        push_token: pushToken,
      });
    } catch (error) {
      // Missing FCM/EAS credentials and denied notification permission are
      // visible in Settings diagnostics; they must not prevent app startup.
      console.warn("Push-token registration failed", error);
    } finally {
      registering.current = false;
    }
  }, [identity]);

  useEffect(() => {
    void register();
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void register();
    });
    return () => subscription.remove();
  }, [register]);
}
