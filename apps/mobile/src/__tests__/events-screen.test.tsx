import { describe, expect, it, vi } from "vitest";
import type { EventRangeItem } from "@personal-os/schema";
import type { RecurrenceEditorState } from "@personal-os/core/recurrence/editor";
import { EditEventView, computeOccurrenceTiming } from "@/app/events/[id]";

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
      startDate: "",
      onStartDateChange: vi.fn(),
      endDate: "",
      onEndDateChange: vi.fn(),
      startsAt: "2026-09-06T14:00:00.000Z",
      onStartsAtChange: vi.fn(),
      endsAt: "2026-09-06T15:00:00.000Z",
      onEndsAtChange: vi.fn(),
      timezone: "America/Chicago",
      onSubmit: vi.fn(),
      onProjectIdChange: vi.fn(),
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
    // Timed event with 1-hour duration
    const timedEvent = {
      all_day: false,
      starts_at: "2026-09-06T14:00:00.000Z",
      ends_at: "2026-09-06T15:00:00.000Z",
    };
    const timedTiming = computeOccurrenceTiming(timedEvent, "2026-09-20T14:00:00.000Z");
    expect(timedTiming.allDay).toBe(false);
    expect(timedTiming.startsAt).toBe("2026-09-20T14:00:00.000Z");
    expect(timedTiming.endsAt).toBe("2026-09-20T15:00:00.000Z");

    // All-day event with 2-day duration
    const allDayEvent = {
      all_day: true,
      start_date: "2026-09-06",
      end_date: "2026-09-08",
    };
    const allDayTiming = computeOccurrenceTiming(allDayEvent, "2026-09-20T00:00:00.000Z");
    expect(allDayTiming.allDay).toBe(true);
    expect(allDayTiming.startDate).toBe("2026-09-20");
    expect(allDayTiming.endDate).toBe("2026-09-22");
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
      startDate: "",
      onStartDateChange: vi.fn(),
      endDate: "",
      onEndDateChange: vi.fn(),
      startsAt: "2026-09-20T14:00:00.000Z",
      onStartsAtChange: vi.fn(),
      endsAt: "2026-09-20T15:00:00.000Z",
      onEndsAtChange: vi.fn(),
      timezone: "America/Chicago",
      onSubmit: vi.fn(),
      onProjectIdChange: vi.fn(),
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
      startDate: "",
      onStartDateChange: vi.fn(),
      endDate: "",
      onEndDateChange: vi.fn(),
      startsAt: "2026-09-20T16:00:00.000Z",
      onStartsAtChange: vi.fn(),
      endsAt: "2026-09-20T17:00:00.000Z",
      onEndsAtChange: vi.fn(),
      timezone: "America/Chicago",
      onSubmit,
      onProjectIdChange: vi.fn(),
    });

    const banner = findByTestId(tree, "detached-event-banner");
    expect(banner).toBeTruthy();
    expect(getTextContent(banner)).toContain(
      "This is a modified occurrence of a recurring event.",
    );

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

    const getCalendarRoute = (entry: EventRangeItem) => {
      if (entry.is_recurring_instance && entry.occurs_at) {
        return `/events/${entry.id}?occursAt=${encodeURIComponent(entry.occurs_at)}`;
      }
      return `/events/${entry.id}`;
    };

    expect(getCalendarRoute(recurringInstance)).toBe(
      "/events/series-uuid-1?occursAt=2026-09-15T14%3A00%3A00.000Z",
    );
    expect(getCalendarRoute(oneOffEvent)).toBe("/events/oneoff-uuid-1");
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
