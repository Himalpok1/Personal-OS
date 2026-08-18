import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { resolveNotificationRoute } from "./resolve-notification-route";

export function useNotificationLifecycle(): void {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === "web") return;

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const route = resolveNotificationRoute(response.notification.request.content.data);
        if (route === null) return;
        // A pushed screen (Settings, a task detail) sits on top of the root
        // stack. Navigating straight to a tab route switches the tab
        // underneath it, so the tap appears to do nothing -- dismiss back to
        // the root first, then navigate.
        if (router.canDismiss()) router.dismissAll();
        router.navigate(route);
      },
    );

    return () => responseSubscription.remove();
  }, [router]);
}
