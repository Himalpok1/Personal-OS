import { describe, expect, it, vi } from "vitest";
import type { CalendarTarget, EventRangeItem, EventSyncState } from "@personal-os/schema";
import type { RecurrenceEditorState } from "@personal-os/core/recurrence/editor";
import {
  EditEventView,
  ExternalEventView,
  computeOccurrenceTiming,
  type EditEventViewProps,
} from "@/app/events/[id]";
import { NewEventView, type NewEventViewProps } from "@/app/events/new";
import { CalendarTargetPicker } from "@/components/calendar/calendar-target-picker";
import { DateField } from "@/components/date-field";
import { DateTimeField } from "@/components/datetime-field";
import { EVENT_NOT_OWNED_MESSAGE } from "@/components/events/event-form-state";
import { eventDetailHref } from "@/utils/event-navigation";

function findByTestId(node: any, testID: string): any {
  if (!node || typeof node !== "object") return null;
  if (node.props?.testID === testID) return node;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, testID);
      if (found) return found;
    }
  }
  if (node.props?.children) {
    const children = Array.isArray(node.props.children)
      ? node.props.children
      : [node.props.children];
    for (const child of children) {
      const found = findByTestId(child, testID);
      if (found) return found;
    }
  }
  return null;
}

function getTextContent(node: any): string {
  if (!node) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  if (node.props?.children) return getTextContent(node.props.children);
  return "";
}

const mockRecurrenceState: RecurrenceEditorState = {
  enabled: true,
  frequency: "WEEKLY",
  interval: 1,
  weekdays: ["SU"],
  monthDay: null,
  endMode: "never",
  untilDate: null,
  count: null,
  anchor: "due_date",
  timezone: "America/Chicago",
  isCustom: false,
  rawRrule: null,
};

const GOOGLE_TARGET: CalendarTarget = {
  connection_id: "11111111-1111-4111-8111-111111111111",
  provider: "google",
  google_calendar_id: "primary",
  caldav_calendar_url: null,
  summary: "Work",
  access_role: "owner",
};

const SYNCED: EventSyncState = {
  status: "synced",
  connection_id: GOOGLE_TARGET.connection_id,
  google_calendar_id: "primary",
  caldav_calendar_url: null,
  last_error: null,
};

// The calendar/link props every EditEventView render needs (Checkpoint 9.5):
// unlinked, no targets, so nothing calendar-related appears unless a test
// overrides it.
const LINK_PROPS = {
  sync: null,
  calendarTargets: [] as CalendarTarget[],
  linkTarget: null,
  onLinkTargetChange: vi.fn(),
  onLink: vi.fn(),
};

function editProps(overrides: Partial<EditEventViewProps> = {}): EditEventViewProps {
  return {
    modalVisible: false,
    onDismissModal: vi.fn(),
    onSelectEditOccurrence: vi.fn(),
    onSelectEditSeries: vi.fn(),
    onCancelOccurrence: vi.fn(),
    isDetached: false,
    editMode: "standard",
    recurrence: mockRecurrenceState,
    onRecurrenceChange: vi.fn(),
    title: "Weekly Sync",
    onTitleChange: vi.fn(),
    description: "",
    onDescriptionChange: vi.fn(),
    location: "",
    onLocationChange: vi.fn(),
    allDay: false,
    onAllDayChange: vi.fn(),
    timed: { startsAt: "2026-09-06T09:00:00-05:00", endsAt: "2026-09-06T10:00:00-05:00" },
    onStartsAtChange: vi.fn(),
    onEndsAtChange: vi.fn(),
    allDayRange: { startDate: null, endDate: null },
    onStartDateChange: vi.fn(),
    onEndDateChange: vi.fn(),
    timezone: "America/Chicago",
    onSubmit: vi.fn(),
    onProjectIdChange: vi.fn(),
    onDelete: vi.fn(),
    ...LINK_PROPS,
    ...overrides,
  };
}

function findByType(node: any, type: unknown): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n.type === type) out.push(n);
    if (n.props?.children) walk(n.props.children);
  };
  walk(node);
  return out;
}

// <CalendarTargetPicker> is a hook-free component element in the views' trees,
// opaque to the walk until called (the task-repeat-field tests do the same
// for RecurrenceEditor). Returns its rendered tree, or null if it is absent.
function expandPicker(tree: any): any {
  const element = findByType(tree, CalendarTargetPicker)[0];
  return element ? CalendarTargetPicker(element.props) : null;
}

describe("EditEventScreen & Recurring Exceptions UX", () => {
  it("displays action modal with 3 options when modalVisible is true", () => {
    const onSelectEditOccurrence = vi.fn();
    const onSelectEditSeries = vi.fn();
    const onCancelOccurrence = vi.fn();
    const onDismissModal = vi.fn();

    const tree = EditEventView({
      modalVisible: true,
      onDismissModal,
      onSelectEditOccurrence,
      onSelectEditSeries,
      onCancelOccurrence,
      isDetached: false,
      editMode: "standard",
      recurrence: mockRecurrenceState,
      onRecurrenceChange: vi.fn(),
      title: "Weekly Sync",
      onTitleChange: vi.fn(),
      description: "Weekly sync meeting",
      onDescriptionChange: vi.fn(),
      location: "Room 101",
      onLocationChange: vi.fn(),
      allDay: false,
      onAllDayChange: vi.fn(),
      timed: { startsAt: "2026-09-06T09:00:00-05:00", endsAt: "2026-09-06T10:00:00-05:00" },
      onStartsAtChange: vi.fn(),
      onEndsAtChange: vi.fn(),
      allDayRange: { startDate: null, endDate: null },
      onStartDateChange: vi.fn(),
      onEndDateChange: vi.fn(),
      timezone: "America/Chicago",
      onSubmit: vi.fn(),
      onProjectIdChange: vi.fn(),
      ...LINK_PROPS,
    });

    const modal = findByTestId(tree, "recurring-action-modal");
    expect(modal).toBeTruthy();
    expect(modal.props.visible).toBe(true);

    const editOccurrenceBtn = findByTestId(tree, "edit-occurrence-button");
    expect(editOccurrenceBtn).toBeTruthy();
    editOccurrenceBtn.props.onPress();
    expect(onSelectEditOccurrence).toHaveBeenCalled();

    const editSeriesBtn = findByTestId(tree, "edit-series-button");
    expect(editSeriesBtn).toBeTruthy();
    editSeriesBtn.props.onPress();
    expect(onSelectEditSeries).toHaveBeenCalled();

    const cancelOccurrenceBtn = findByTestId(tree, "cancel-occurrence-button");
    expect(cancelOccurrenceBtn).toBeTruthy();
    cancelOccurrenceBtn.props.onPress();
    expect(onCancelOccurrence).toHaveBeenCalled();

    const dismissBtn = findByTestId(tree, "dismiss-modal-button");
    expect(dismissBtn).toBeTruthy();
    dismissBtn.props.onPress();
    expect(onDismissModal).toHaveBeenCalled();
  });

  it("calculates occurrence timing correctly from occursAt preserving duration", () => {
    // Timed event with 1-hour duration -- timing is unchanged by the
    // timezone fix, since timed occurrences already use the real instant
    // directly rather than deriving a calendar date from it.
    const timedEvent = {
      all_day: false,
      starts_at: "2026-09-06T14:00:00.000Z",
      ends_at: "2026-09-06T15:00:00.000Z",
      timezone: "America/Chicago",
    };
    const timedTiming = computeOccurrenceTiming(timedEvent, "2026-09-20T14:00:00.000Z");
    expect(timedTiming.allDay).toBe(false);
    expect(timedTiming.startsAt).toBe("2026-09-20T14:00:00.000Z");
    expect(timedTiming.endsAt).toBe("2026-09-20T15:00:00.000Z");

    // All-day event with 2-day duration, in UTC -- local noon UTC is
    // "2026-09-20T12:00:00.000Z", still calendar date 2026-09-20 in UTC.
    const allDayEvent = {
      all_day: true,
      start_date: "2026-09-06",
      end_date: "2026-09-08",
      timezone: "UTC",
    };
    const allDayTiming = computeOccurrenceTiming(allDayEvent, "2026-09-20T12:00:00.000Z");
    expect(allDayTiming.allDay).toBe(true);
    expect(allDayTiming.startDate).toBe("2026-09-20");
    expect(allDayTiming.endDate).toBe("2026-09-22");
  });

  describe("computeOccurrenceTiming -- all-day timezone-correct calendar date derivation", () => {
    // Checkpoint 5.4 anchors recurring all-day occurrences at LOCAL NOON in
    // the event's recurrence timezone. `occursAt` is therefore an ISO
    // instant whose UTC calendar date can legitimately differ from the
    // occurrence's actual local calendar date. The old implementation did
    // `occursAt.slice(0, 10)`, reading the UTC date directly -- these tests
    // prove that is wrong for any zone where local noon falls on a
    // different UTC calendar day, and that the fix (deriving the date via
    // `resolveInstantToLocalUntil` in the event's own timezone) is correct.

    it("resolves the correct local date in Pacific/Auckland (UTC+13, local noon crosses into the previous UTC day)", () => {
      // Local noon 2026-09-20 in Pacific/Auckland (UTC+13, no DST active
      // for NZ in September -- NZDT starts late Sept) is 2026-09-19T23:00:00Z.
      // The old `slice(0, 10)` logic would read "2026-09-19" -- one day
      // early. The fix must read "2026-09-20".
      const event = {
        all_day: true,
        start_date: "2026-09-20",
        end_date: "2026-09-20",
        timezone: "Pacific/Auckland",
      };
      const occursAt = "2026-09-19T23:00:00.000Z";
      // Sanity-check the premise: naive UTC slicing of this instant really
      // does yield the wrong date, so a regression back to the old logic
      // would be caught by the assertion below, not silently pass.
      expect(occursAt.slice(0, 10)).toBe("2026-09-19");

      const timing = computeOccurrenceTiming(event, occursAt);
      expect(timing.startDate).toBe("2026-09-20");
      expect(timing.endDate).toBe("2026-09-20");
    });

    it("resolves the correct local date in America/Chicago (negative offset)", () => {
      // Local noon 2026-09-20 CDT (UTC-5) is 2026-09-20T17:00:00Z -- still
      // the same UTC calendar day here, so this exercises the negative-
      // offset path without also crossing a UTC day boundary.
      const event = {
        all_day: true,
        start_date: "2026-09-20",
        end_date: "2026-09-20",
        timezone: "America/Chicago",
      };
      const occursAt = "2026-09-20T17:00:00.000Z";
      const timing = computeOccurrenceTiming(event, occursAt);
      expect(timing.startDate).toBe("2026-09-20");
      expect(timing.endDate).toBe("2026-09-20");
    });

    it("resolves the correct local date in UTC itself", () => {
      const event = {
        all_day: true,
        start_date: "2026-09-20",
        end_date: "2026-09-20",
        timezone: "UTC",
      };
      const occursAt = "2026-09-20T12:00:00.000Z";
      const timing = computeOccurrenceTiming(event, occursAt);
      expect(timing.startDate).toBe("2026-09-20");
      expect(timing.endDate).toBe("2026-09-20");
    });

    it("preserves a multi-day all-day series' day-span on a single occurrence, using the recurrence timezone when present", () => {
      // recurrence_timezone takes priority over the event's own timezone,
      // matching the API's `parent.recurrenceTimezone ?? parent.timezone`
      // precedent. Local noon 2026-09-20 in Pacific/Auckland is
      // 2026-09-19T23:00:00Z -- if the fix used `event.timezone` (UTC)
      // instead of `recurrence_timezone`, this would resolve to the wrong
      // date and the span-preservation assertion below would fail.
      const event = {
        all_day: true,
        start_date: "2026-09-06",
        end_date: "2026-09-08", // 2-day span
        timezone: "UTC",
        recurrence_timezone: "Pacific/Auckland",
      };
      const occursAt = "2026-09-19T23:00:00.000Z";
      const timing = computeOccurrenceTiming(event, occursAt);
      expect(timing.startDate).toBe("2026-09-20");
      expect(timing.endDate).toBe("2026-09-22");
    });

    it("leaves timed (non-all-day) occurrence timing unaffected by the timezone fix", () => {
      const event = {
        all_day: false,
        starts_at: "2026-09-06T14:00:00.000Z",
        ends_at: "2026-09-06T15:30:00.000Z",
        timezone: "Pacific/Auckland",
        recurrence_timezone: "Pacific/Auckland",
      };
      const occursAt = "2026-09-19T23:00:00.000Z";
      const timing = computeOccurrenceTiming(event, occursAt);
      expect(timing.allDay).toBe(false);
      expect(timing.startsAt).toBe(occursAt);
      expect(timing.endsAt).toBe("2026-09-20T00:30:00.000Z");
    });
  });

  it("hides recurrence editor in occurrence edit mode", () => {
    const tree = EditEventView({
      modalVisible: false,
      onDismissModal: vi.fn(),
      onSelectEditOccurrence: vi.fn(),
      onSelectEditSeries: vi.fn(),
      onCancelOccurrence: vi.fn(),
      isDetached: false,
      editMode: "occurrence",
      recurrence: mockRecurrenceState,
      onRecurrenceChange: vi.fn(),
      title: "Weekly Sync",
      onTitleChange: vi.fn(),
      description: "",
      onDescriptionChange: vi.fn(),
      location: "",
      onLocationChange: vi.fn(),
      allDay: false,
      onAllDayChange: vi.fn(),
      timed: { startsAt: "2026-09-20T09:00:00-05:00", endsAt: "2026-09-20T10:00:00-05:00" },
      onStartsAtChange: vi.fn(),
      onEndsAtChange: vi.fn(),
      allDayRange: { startDate: null, endDate: null },
      onStartDateChange: vi.fn(),
      onEndDateChange: vi.fn(),
      timezone: "America/Chicago",
      onSubmit: vi.fn(),
      onProjectIdChange: vi.fn(),
      ...LINK_PROPS,
    });

    expect(findByTestId(tree, "recurrence-section")).toBeNull();
  });

  it("displays detached event exception banner and hides recurrence editor", () => {
    const onSubmit = vi.fn();
    const tree = EditEventView({
      modalVisible: false,
      onDismissModal: vi.fn(),
      onSelectEditOccurrence: vi.fn(),
      onSelectEditSeries: vi.fn(),
      onCancelOccurrence: vi.fn(),
      isDetached: true,
      editMode: "standard",
      recurrence: mockRecurrenceState,
      onRecurrenceChange: vi.fn(),
      title: "Modified Sync Occurrence",
      onTitleChange: vi.fn(),
      description: "One-off time shift",
      onDescriptionChange: vi.fn(),
      location: "Room 202",
      onLocationChange: vi.fn(),
      allDay: false,
      onAllDayChange: vi.fn(),
      timed: { startsAt: "2026-09-20T11:00:00-05:00", endsAt: "2026-09-20T12:00:00-05:00" },
      onStartsAtChange: vi.fn(),
      onEndsAtChange: vi.fn(),
      allDayRange: { startDate: null, endDate: null },
      onStartDateChange: vi.fn(),
      onEndDateChange: vi.fn(),
      timezone: "America/Chicago",
      onSubmit,
      onProjectIdChange: vi.fn(),
      ...LINK_PROPS,
    });

    const banner = findByTestId(tree, "detached-event-banner");
    expect(banner).toBeTruthy();
    expect(getTextContent(banner)).toContain("This is a modified occurrence of a recurring event.");

    expect(findByTestId(tree, "recurrence-section")).toBeNull();

    const saveBtn = findByTestId(tree, "save-event-button");
    expect(saveBtn).toBeTruthy();
    saveBtn.props.onPress();
    expect(onSubmit).toHaveBeenCalled();
  });

  it("routes calendar events correctly with occursAt for recurring instances", () => {
    const recurringInstance: EventRangeItem = {
      id: "series-uuid-1",
      title: "Weekly Standup",
      description: null,
      location: null,
      all_day: false,
      starts_at: "2026-09-01T14:00:00.000Z",
      ends_at: "2026-09-01T14:30:00.000Z",
      start_date: null,
      end_date: null,
      is_recurring_instance: true,
      occurs_at: "2026-09-15T14:00:00.000Z",
      occurs_ends_at: "2026-09-15T14:30:00.000Z",
      status: "scheduled",
    };

    const oneOffEvent: EventRangeItem = {
      id: "oneoff-uuid-1",
      title: "Doctor Appointment",
      description: null,
      location: null,
      all_day: false,
      starts_at: "2026-09-15T10:00:00.000Z",
      ends_at: "2026-09-15T11:00:00.000Z",
      start_date: null,
      end_date: null,
      is_recurring_instance: false,
      occurs_at: null,
      occurs_ends_at: null,
      status: null,
    };

    // The one href rule Today and the Agenda both use (utils/event-navigation.ts).
    expect(eventDetailHref(recurringInstance.id, recurringInstance.occurs_at)).toBe(
      "/events/series-uuid-1?occursAt=2026-09-15T14%3A00%3A00.000Z",
    );
    expect(eventDetailHref(oneOffEvent.id, oneOffEvent.occurs_at)).toBe("/events/oneoff-uuid-1");
  });

  it("calls detachEvent API and cancelEventOccurrence API properly", async () => {
    const { api } = await import("@/queries/client");
    const detachSpy = vi.spyOn(api, "detachEvent").mockResolvedValue({} as any);
    const cancelSpy = vi.spyOn(api, "cancelEventOccurrence").mockResolvedValue({} as any);

    await api.detachEvent("series-1", {
      original_start_at: "2026-09-15T14:00:00.000Z",
      title: "Modified Sync",
      starts_at: "2026-09-15T15:00:00.000Z",
      ends_at: "2026-09-15T16:00:00.000Z",
    });

    expect(detachSpy).toHaveBeenCalledWith("series-1", {
      original_start_at: "2026-09-15T14:00:00.000Z",
      title: "Modified Sync",
      starts_at: "2026-09-15T15:00:00.000Z",
      ends_at: "2026-09-15T16:00:00.000Z",
    });

    await api.cancelEventOccurrence("series-1", {
      original_start_at: "2026-09-15T14:00:00.000Z",
    });

    expect(cancelSpy).toHaveBeenCalledWith("series-1", {
      original_start_at: "2026-09-15T14:00:00.000Z",
    });
  });
});

describe("Checkpoint 9.5 -- ownership, calendar and sync on the edit screen", () => {
  it("an external event renders read-only: no Save, no Delete, no link, no occurrence modal", () => {
    const tree = ExternalEventView({
      title: "Team offsite",
      whenLabel: "Sep 15, 2026 · all day",
      location: "HQ",
      description: "Bring a laptop https://example.invalid/join",
      calendarLine: "From connected calendar · read-only",
      timezone: "America/Chicago",
    });
    expect(findByTestId(tree, "external-event-view")).toBeTruthy();
    expect(getTextContent(findByTestId(tree, "external-event-banner"))).toBe(
      "From connected calendar · read-only",
    );
    expect(getTextContent(findByTestId(tree, "external-event-when"))).toBe(
      "Sep 15, 2026 · all day",
    );
    expect(getTextContent(tree)).toContain("Team offsite");
    expect(getTextContent(tree)).toContain("Bring a laptop https://example.invalid/join");
    for (const id of [
      "save-event-button",
      "archive-event-button",
      "link-calendar-button",
      "calendar-target-picker",
      "recurring-action-modal",
      "recurrence-section",
    ]) {
      expect(findByTestId(tree, id), id).toBeNull();
    }
    // Every string lands in a <Text>; nothing is a link or a pressable.
    expect(findByType(tree, "a")).toEqual([]);
  });

  it("a local linked event shows its calendar and the sync status line, and no link control", () => {
    const tree = EditEventView(
      editProps({
        sync: { ...SYNCED, status: "pending_push" },
        calendarTargets: [GOOGLE_TARGET],
      }),
    );
    expect(getTextContent(findByTestId(tree, "event-calendar-label"))).toBe("Synced to Work");
    expect(getTextContent(findByTestId(tree, "event-sync-status"))).toBe("Syncing to calendar…");
    expect(expandPicker(tree)).toBeNull();
    expect(findByTestId(tree, "link-calendar-button")).toBeNull();
    expect(findByTestId(tree, "save-event-button")).toBeTruthy();
    expect(findByTestId(tree, "archive-event-button")).toBeTruthy();
  });

  it("a synced local event shows no status line; conflict and error each get theirs", () => {
    expect(
      findByTestId(EditEventView(editProps({ sync: SYNCED })), "event-sync-status"),
    ).toBeNull();
    expect(
      getTextContent(
        findByTestId(
          EditEventView(editProps({ sync: { ...SYNCED, status: "conflict" } })),
          "event-sync-status",
        ),
      ),
    ).toBe("Calendar conflict — your latest edit hasn't been synced. Save it again to retry.");
    expect(
      getTextContent(
        findByTestId(
          EditEventView(editProps({ sync: { ...SYNCED, status: "error" } })),
          "event-sync-status",
        ),
      ),
    ).toBe("Calendar sync failed");
  });

  it("a LINKED local series' occurrence modal offers only 'Cancel this occurrence' and 'Edit entire series'", () => {
    const onSelectEditOccurrence = vi.fn();
    const linked = EditEventView(
      editProps({ modalVisible: true, sync: SYNCED, onSelectEditOccurrence }),
    );
    expect(findByTestId(linked, "recurring-action-modal").props.visible).toBe(true);
    expect(findByTestId(linked, "edit-occurrence-button")).toBeNull();
    expect(findByTestId(linked, "edit-series-button")).toBeTruthy();
    expect(findByTestId(linked, "cancel-occurrence-button")).toBeTruthy();
    expect(getTextContent(findByTestId(linked, "recurring-action-modal"))).not.toContain(
      "Edit this occurrence",
    );
    expect(getTextContent(findByTestId(linked, "recurring-action-modal"))).toContain(
      "synced to a calendar",
    );
    expect(onSelectEditOccurrence).not.toHaveBeenCalled();
    // An UNLINKED local series keeps all three options.
    const unlinked = EditEventView(editProps({ modalVisible: true, sync: null }));
    expect(findByTestId(unlinked, "edit-occurrence-button")).toBeTruthy();
  });

  it("a failed calendar-targets query shows a muted note on an unlinked event, and nothing on a linked one", () => {
    const unlinked = EditEventView(editProps({ calendarTargetsError: true }));
    expect(getTextContent(findByTestId(unlinked, "calendar-targets-error"))).toBe(
      "Couldn't load calendars — this event will stay in Personal OS only",
    );
    expect(findByTestId(unlinked, "save-event-button")).toBeTruthy();
    expect(findByTestId(EditEventView(editProps()), "calendar-targets-error")).toBeNull();
    expect(
      findByTestId(
        EditEventView(editProps({ calendarTargetsError: true, sync: SYNCED })),
        "calendar-targets-error",
      ),
    ).toBeNull();
  });

  it("a local UNLINKED event offers the link picker from the targets list, and the button once a target is picked", () => {
    const onLinkTargetChange = vi.fn();
    const onLink = vi.fn();
    const noPick = EditEventView(
      editProps({ calendarTargets: [GOOGLE_TARGET], onLinkTargetChange }),
    );
    expect(getTextContent(findByTestId(noPick, "event-calendar-label"))).toBe(
      "Not synced to a calendar",
    );
    const picker = expandPicker(noPick);
    expect(findByTestId(picker, "calendar-target-picker")).toBeTruthy();
    expect(findByTestId(noPick, "link-calendar-button")).toBeNull();
    findByTestId(picker, `calendar-target-${GOOGLE_TARGET.connection_id}:primary`).props.onPress();
    expect(onLinkTargetChange).toHaveBeenCalledWith(GOOGLE_TARGET);

    const picked = EditEventView(
      editProps({ calendarTargets: [GOOGLE_TARGET], linkTarget: GOOGLE_TARGET, onLink }),
    );
    const button = findByTestId(picked, "link-calendar-button");
    expect(button).toBeTruthy();
    button.props.onPress();
    expect(onLink).toHaveBeenCalled();
    // With no writable calendar at all the picker renders nothing.
    expect(expandPicker(EditEventView(editProps()))).toBeNull();
  });

  it("a 409 event_not_owned renders the ownership line inline", () => {
    const tree = EditEventView(editProps({ errorMessage: EVENT_NOT_OWNED_MESSAGE }));
    expect(getTextContent(findByTestId(tree, "event-error"))).toBe(
      "This event belongs to a connected calendar and can't be changed here.",
    );
  });

  it("timed fields are the picker fields seeded with offset-bearing instants; all-day uses the date-only field", () => {
    const timed = EditEventView(editProps());
    const [starts, ends] = findByType(timed, DateTimeField);
    expect(starts.props.value).toBe("2026-09-06T09:00:00-05:00");
    expect(ends.props.value).toBe("2026-09-06T10:00:00-05:00");
    expect(findByType(timed, DateField)).toEqual([]);

    const allDay = EditEventView(
      editProps({ allDay: true, allDayRange: { startDate: "2026-09-06", endDate: "2026-09-07" } }),
    );
    const [startDate, endDate] = findByType(allDay, DateField);
    expect(startDate.props.value).toBe("2026-09-06");
    expect(endDate.props.value).toBe("2026-09-07");
    expect(endDate.props.clearable).toBe(false);
    expect(findByType(allDay, DateTimeField)).toEqual([]);
  });

  it("Delete goes through the screen's confirm callback, labelled as a delete", () => {
    const onDelete = vi.fn();
    const tree = EditEventView(editProps({ onDelete }));
    const button = findByTestId(tree, "archive-event-button");
    expect(getTextContent(button)).toBe("Delete event");
    button.props.onPress();
    expect(onDelete).toHaveBeenCalled();
  });
});

describe("NewEventView (Checkpoint 9.5)", () => {
  function newProps(overrides: Partial<NewEventViewProps> = {}): NewEventViewProps {
    return {
      timezone: "America/Chicago",
      title: "Dentist",
      onTitleChange: vi.fn(),
      description: "",
      onDescriptionChange: vi.fn(),
      location: "",
      onLocationChange: vi.fn(),
      allDay: false,
      onAllDayChange: vi.fn(),
      timed: { startsAt: "2026-09-15T14:00:00-05:00", endsAt: "2026-09-15T15:00:00-05:00" },
      onStartsAtChange: vi.fn(),
      onEndsAtChange: vi.fn(),
      allDayRange: { startDate: null, endDate: null },
      onStartDateChange: vi.fn(),
      onEndDateChange: vi.fn(),
      recurrence: { ...mockRecurrenceState, enabled: false },
      onRecurrenceChange: vi.fn(),
      calendarTargets: [],
      calendar: null,
      onCalendarChange: vi.fn(),
      onProjectIdChange: vi.fn(),
      formError: null,
      onSubmit: vi.fn(),
      ...overrides,
    };
  }

  it("hides the calendar picker entirely with zero targets, and offers 'Personal OS only' first otherwise", () => {
    expect(expandPicker(NewEventView(newProps()))).toBeNull();
    const picker = expandPicker(NewEventView(newProps({ calendarTargets: [GOOGLE_TARGET] })));
    expect(findByTestId(picker, "calendar-target-picker")).toBeTruthy();
    const none = findByTestId(picker, "calendar-target-none");
    expect(getTextContent(none)).toBe("Personal OS only");
    expect(none.props.accessibilityState.selected).toBe(true);
    expect(
      getTextContent(
        findByTestId(picker, `calendar-target-${GOOGLE_TARGET.connection_id}:primary`),
      ),
    ).toBe("Work");
  });

  it("uses the picker fields for timed and the date-only fields for all-day, and shows the form error", () => {
    const timed = NewEventView(newProps());
    expect(findByType(timed, DateTimeField)).toHaveLength(2);
    expect(findByType(timed, DateField)).toEqual([]);
    const allDay = NewEventView(
      newProps({ allDay: true, allDayRange: { startDate: "2026-09-15", endDate: "2026-09-15" } }),
    );
    expect(findByType(allDay, DateField)).toHaveLength(2);
    expect(findByType(allDay, DateTimeField)).toEqual([]);
    expect(
      getTextContent(
        findByTestId(
          NewEventView(newProps({ formError: "The end must be after the start." })),
          "event-form-error",
        ),
      ),
    ).toBe("The end must be after the start.");
  });

  it("shows a muted note when the targets query errored, and still lets the event be created", () => {
    const onSubmit = vi.fn();
    const tree = NewEventView(newProps({ calendarTargetsError: true, onSubmit }));
    expect(expandPicker(tree)).toBeNull();
    expect(getTextContent(findByTestId(tree, "calendar-targets-error"))).toBe(
      "Couldn't load calendars — this event will stay in Personal OS only",
    );
    const button = findByTestId(tree, "create-event-button");
    expect(button.props.disabled).toBe(false);
    button.props.onPress();
    expect(onSubmit).toHaveBeenCalled();
    // No note while the query is fine (or merely empty), and none once a
    // stale-but-present list is still being offered.
    expect(findByTestId(NewEventView(newProps()), "calendar-targets-error")).toBeNull();
    expect(
      findByTestId(
        NewEventView(newProps({ calendarTargetsError: true, calendarTargets: [GOOGLE_TARGET] })),
        "calendar-targets-error",
      ),
    ).toBeNull();
  });

  it("the Create button submits and is disabled without a title", () => {
    const onSubmit = vi.fn();
    const button = findByTestId(NewEventView(newProps({ onSubmit })), "create-event-button");
    button.props.onPress();
    expect(onSubmit).toHaveBeenCalled();
    expect(
      findByTestId(NewEventView(newProps({ title: "  " })), "create-event-button").props.disabled,
    ).toBe(true);
  });
});
