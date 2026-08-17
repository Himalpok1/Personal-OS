import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

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
        const taskId = response.notification.request.content.data?.["taskId"];
        if (typeof taskId === "string") router.push(`/tasks/${taskId}`);
      },
    );

    return () => responseSubscription.remove();
  }, [router]);
}
