import type { Task } from "@personal-os/schema";
import { parseRRuleStringToEditorState } from "@personal-os/core/recurrence/editor";
import { describe, expect, it } from "vitest";
import { selectPreset, setAfterCompletion } from "./recurrence/task-repeat-state";
import {
  buildTaskUpdatePatch,
  normalizeRrule,
  recurrenceChanged,
  sameInstant,
  type TaskEditForm,
} from "./task-update-patch";

const TZ = "America/Chicago";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Water the plants",
    body: null,
    status: "active",
    due_at: "2026-09-14T14:00:00.000Z",
    remind_at: null,
    timezone: TZ,
    priority: null,
    project_id: null,
    canvas_assignment_id: null,
    completed_at: null,
    rrule: null,
    recurrence_anchor: null,
    recurrence_timezone: null,
    recurrence_until: null,
    recurrence_count: null,
    recurrence_exdates: null,
    archived_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The form exactly as the edit screen loads it from `loaded`. */
function formOf(loaded: Task, overrides: Partial<TaskEditForm> = {}): TaskEditForm {
  return {
    title: loaded.title,
    body: loaded.body ?? "",
    dueAt: loaded.due_at,
    remindAt: loaded.remind_at,
    projectId: loaded.project_id ?? undefined,
    recurrence: parseRRuleStringToEditorState(loaded.rrule, {
      recurrenceTimezone: loaded.recurrence_timezone,
      recurrenceUntil: loaded.recurrence_until,
      recurrenceCount: loaded.recurrence_count,
      recurrenceAnchor: loaded.recurrence_anchor,
      defaultTimezone: loaded.timezone,
    }),
    ...overrides,
  };
}

const RECURRING = task({
  rrule: "FREQ=WEEKLY;BYDAY=MO",
  recurrence_anchor: "due_date",
  recurrence_timezone: TZ,
});

describe("sameInstant", () => {
  it("compares by instant, so an offset spelling equals its UTC spelling", () => {
    expect(sameInstant("2026-09-14T09:00:00-05:00", "2026-09-14T14:00:00.000Z")).toBe(true);
    expect(sameInstant("2026-09-14T09:00:00-05:00", "2026-09-14T14:01:00.000Z")).toBe(false);
  });

  it("treats null as equal only to null", () => {
    expect(sameInstant(null, null)).toBe(true);
    expect(sameInstant(null, "2026-09-14T14:00:00.000Z")).toBe(false);
    expect(sameInstant("2026-09-14T14:00:00.000Z", null)).toBe(false);
  });

  it("falls back to string equality for values that do not parse", () => {
    expect(sameInstant("later", "later")).toBe(true);
    expect(sameInstant("later", "sooner")).toBe(false);
  });
});

describe("normalizeRrule", () => {
  it("ignores case, the RRULE: prefix and an explicit INTERVAL=1", () => {
    expect(normalizeRrule("rrule:freq=daily;interval=1")).toBe("FREQ=DAILY");
    expect(normalizeRrule("FREQ=DAILY")).toBe("FREQ=DAILY");
    expect(normalizeRrule("FREQ=DAILY;INTERVAL=2")).toBe("FREQ=DAILY;INTERVAL=2");
    expect(normalizeRrule(null)).toBeNull();
  });

  it("sorts the parts, as the server's task-recurrence-diff does, so part order never reads as a change", () => {
    expect(normalizeRrule("BYDAY=TU;FREQ=WEEKLY")).toBe("BYDAY=TU;FREQ=WEEKLY");
    expect(normalizeRrule("FREQ=WEEKLY;BYDAY=TU")).toBe("BYDAY=TU;FREQ=WEEKLY");
    expect(normalizeRrule("byday=tu;freq=weekly;interval=1")).toBe(
      normalizeRrule("FREQ=WEEKLY;BYDAY=TU"),
    );
    const snapshot = {
      recurrence_timezone: TZ,
      recurrence_anchor: "due_date" as const,
      recurrence_until: null,
      recurrence_count: null,
    };
    expect(
      recurrenceChanged(
        { ...snapshot, rrule: "BYDAY=TU;FREQ=WEEKLY" },
        { ...snapshot, rrule: "FREQ=WEEKLY;BYDAY=TU" },
      ),
    ).toBe(false);
  });
});

describe("buildTaskUpdatePatch", () => {
  it("sends only title/body/project for an untouched form", () => {
    const loaded = RECURRING;
    const patch = buildTaskUpdatePatch(loaded, formOf(loaded));
    expect(patch).toEqual({ title: "Water the plants", body: "", project_id: null });
    expect("rrule" in patch).toBe(false);
    expect("due_at" in patch).toBe(false);
    expect("remind_at" in patch).toBe(false);
  });

  it("a title-only edit on a recurring task does not carry the recurrence fields", () => {
    const patch = buildTaskUpdatePatch(RECURRING, formOf(RECURRING, { title: "  Water them  " }));
    expect(patch).toEqual({ title: "Water them", body: "", project_id: null });
  });

  it("sends due_at only when its instant changed -- an offset re-spelling is not a change", () => {
    const same = buildTaskUpdatePatch(
      RECURRING,
      formOf(RECURRING, { dueAt: "2026-09-14T09:00:00-05:00" }),
    );
    expect("due_at" in same).toBe(false);

    const moved = buildTaskUpdatePatch(
      RECURRING,
      formOf(RECURRING, { dueAt: "2026-09-15T09:00:00-05:00" }),
    );
    expect(moved.due_at).toBe("2026-09-15T09:00:00-05:00");
    // Moving the due date alone does not re-send the (unchanged) rule.
    expect("rrule" in moved).toBe(false);

    const cleared = buildTaskUpdatePatch(RECURRING, formOf(RECURRING, { dueAt: null }));
    expect(cleared.due_at).toBeNull();
  });

  it("sends remind_at only when changed", () => {
    const withReminder = task({ remind_at: "2026-09-14T13:00:00.000Z" });
    expect("remind_at" in buildTaskUpdatePatch(withReminder, formOf(withReminder))).toBe(false);
    expect(
      buildTaskUpdatePatch(withReminder, formOf(withReminder, { remindAt: null })).remind_at,
    ).toBeNull();
    expect(
      buildTaskUpdatePatch(task(), formOf(task(), { remindAt: "2026-09-14T13:00:00.000Z" }))
        .remind_at,
    ).toBe("2026-09-14T13:00:00.000Z");
  });

  it("sends all five recurrence fields together when the rule changed", () => {
    const loaded = task();
    const recurrence = selectPreset(formOf(loaded).recurrence, "daily", {
      dueAt: loaded.due_at,
      timezone: TZ,
    });
    const patch = buildTaskUpdatePatch(loaded, formOf(loaded, { recurrence }));
    expect(patch).toEqual({
      title: "Water the plants",
      body: "",
      project_id: null,
      rrule: "FREQ=DAILY",
      recurrence_timezone: TZ,
      recurrence_anchor: "due_date",
      recurrence_until: null,
      recurrence_count: null,
    });
  });

  it("an anchor change alone is a recurrence change", () => {
    const recurrence = setAfterCompletion(formOf(RECURRING).recurrence, true, {
      dueAt: RECURRING.due_at,
      timezone: TZ,
    });
    const patch = buildTaskUpdatePatch(RECURRING, formOf(RECURRING, { recurrence }));
    expect(patch.rrule).toBe("FREQ=WEEKLY");
    expect(patch.recurrence_anchor).toBe("completion_date");
  });

  it("removing the repeat sends explicit nulls for every recurrence field", () => {
    const recurrence = selectPreset(formOf(RECURRING).recurrence, "never", {
      dueAt: RECURRING.due_at,
      timezone: TZ,
    });
    const patch = buildTaskUpdatePatch(RECURRING, formOf(RECURRING, { recurrence }));
    expect(patch).toMatchObject({
      rrule: null,
      recurrence_timezone: null,
      recurrence_anchor: null,
      recurrence_until: null,
      recurrence_count: null,
    });
  });

  it("re-deriving weekly from the same due date is not a change", () => {
    const form = formOf(RECURRING);
    const recurrence = selectPreset(form.recurrence, "weekly", {
      dueAt: RECURRING.due_at,
      timezone: TZ,
    });
    expect("rrule" in buildTaskUpdatePatch(RECURRING, { ...form, recurrence })).toBe(false);
  });

  it("a stored INTERVAL=1 round-trips as unchanged", () => {
    const loaded = task({
      rrule: "FREQ=DAILY;INTERVAL=1",
      recurrence_anchor: "due_date",
      recurrence_timezone: TZ,
    });
    expect("rrule" in buildTaskUpdatePatch(loaded, formOf(loaded))).toBe(false);
  });

  it("a stored until/count round-trips as unchanged and is compared by instant", () => {
    const loaded = task({
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      recurrence_anchor: "due_date",
      recurrence_timezone: TZ,
      // 23:59:59.999 local on 2026-12-31 in Chicago (CST, UTC-6) -- what the
      // editor itself serializes an until-date to.
      recurrence_until: "2027-01-01T05:59:59.999Z",
    });
    expect("rrule" in buildTaskUpdatePatch(loaded, formOf(loaded))).toBe(false);

    const counted = task({
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      recurrence_anchor: "due_date",
      recurrence_timezone: TZ,
      recurrence_count: 10,
    });
    expect("rrule" in buildTaskUpdatePatch(counted, formOf(counted))).toBe(false);
  });

  it("a custom rule the presets cannot express round-trips as unchanged", () => {
    const loaded = task({
      rrule: "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1",
      recurrence_anchor: "due_date",
      recurrence_timezone: TZ,
    });
    expect(formOf(loaded).recurrence.isCustom).toBe(true);
    expect("rrule" in buildTaskUpdatePatch(loaded, formOf(loaded))).toBe(false);
  });
});

describe("recurrenceChanged", () => {
  it("is false for two absent rules whatever the other fields hold", () => {
    expect(
      recurrenceChanged(
        { rrule: null, recurrence_timezone: null, recurrence_anchor: null, recurrence_until: null, recurrence_count: null },
        { rrule: null, recurrence_timezone: TZ, recurrence_anchor: "due_date", recurrence_until: null, recurrence_count: null },
      ),
    ).toBe(false);
  });

  it("treats a missing anchor as due_date", () => {
    expect(
      recurrenceChanged(
        { rrule: "FREQ=DAILY", recurrence_timezone: TZ, recurrence_anchor: null, recurrence_until: null, recurrence_count: null },
        { rrule: "FREQ=DAILY", recurrence_timezone: TZ, recurrence_anchor: "due_date", recurrence_until: null, recurrence_count: null },
      ),
    ).toBe(false);
  });

  it("notices a timezone change", () => {
    expect(
      recurrenceChanged(
        { rrule: "FREQ=DAILY", recurrence_timezone: TZ, recurrence_anchor: "due_date", recurrence_until: null, recurrence_count: null },
        { rrule: "FREQ=DAILY", recurrence_timezone: "Europe/London", recurrence_anchor: "due_date", recurrence_until: null, recurrence_count: null },
      ),
    ).toBe(true);
  });
});
