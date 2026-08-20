import { Pressable, Text, View } from "react-native";
import { useLinkableGoogleCalendars } from "@/queries/calendar-connections";

// Locked Decision 9: explicit outbound linking is the *only* way an event
// starts syncing to Google -- no automatic behavior tied to project_id or
// anything else. This picker only renders once at least one active Google
// connection has at least one sync_enabled calendar (configured from the
// Settings screen's "Connected Calendars" card); a plain event with nothing
// selected here stays fully local, exactly as before Checkpoint 4.5.
export interface GoogleCalendarLinkPickerProps {
  selectedGoogleCalendarId: string | undefined;
  onChange: (googleCalendarId: string | undefined) => void;
  alreadyLinkedNote?: string;
}

export function GoogleCalendarLinkPicker({
  selectedGoogleCalendarId,
  onChange,
  alreadyLinkedNote,
}: GoogleCalendarLinkPickerProps) {
  const { calendars } = useLinkableGoogleCalendars();

  if (calendars.length === 0) return null;

  return (
    <View className="mb-4">
      <Text className="mb-1 text-sm text-neutral-500">Sync to Google calendar (optional)</Text>
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          onPress={() => onChange(undefined)}
          className={
            selectedGoogleCalendarId === undefined
              ? "rounded-full bg-blue-600 px-3 py-1"
              : "rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800"
          }
        >
          <Text
            className={
              selectedGoogleCalendarId === undefined
                ? "text-white"
                : "text-black dark:text-white"
            }
          >
            Don&apos;t sync
          </Text>
        </Pressable>
        {calendars.map((calendar) => (
          <Pressable
            key={calendar.google_calendar_id}
            onPress={() => onChange(calendar.google_calendar_id)}
            className={
              selectedGoogleCalendarId === calendar.google_calendar_id
                ? "rounded-full bg-blue-600 px-3 py-1"
                : "rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800"
            }
          >
            <Text
              className={
                selectedGoogleCalendarId === calendar.google_calendar_id
                  ? "text-white"
                  : "text-black dark:text-white"
              }
            >
              {calendar.summary}
            </Text>
          </Pressable>
        ))}
      </View>
      {alreadyLinkedNote ? (
        <Text className="mt-1 text-xs text-neutral-500">{alreadyLinkedNote}</Text>
      ) : null}
    </View>
  );
}
