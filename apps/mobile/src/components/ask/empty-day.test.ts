import type { RemindersResponse, TodayResponse, TodayTaskItem } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { askPresetOf, ASK_PRESETS } from "./ask-presets";
import {
  ASK_REMINDER_HORIZON_DAYS,
  hasReminderWithinHorizon,
  isTodayEmpty,
  planAskSubmission,
} from "./empty-day";

const ID = "11111111-1111-4111-8111-111111111111";

function emptyToday(overrides: Partial<TodayResponse> = {}): TodayResponse {
  return {
    generated_at: "2026-09-14T12:00:00.000Z",
    effective_now: "2026-09-14T12:00:00.000Z",
    tz: "America/Chicago",
    local_date: "2026-09-14",
    summary: {
      overdue_total: 0,
      due_today_total: 0,
      inbox_attention_total: 0,
      active_project_count: 0,
    },
    overdue: { items: [], total: 0 },
    due_today: { items: [], total: 0 },
    events_today: { items: [] },
    upcoming: { days: [] },
    inbox: { pending_count: 0, needs_confirm_count: 0, failed_count: 0, items: [] },
    projects: { active_count: 0, items: [] },
    reviews: {
      daily: { period_start: "2026-09-14", review_id: null, status: null, last_completed_at: null },
      weekly: {
        period_start: "2026-09-14",
        review_id: null,
        status: null,
        last_completed_at: null,
      },
    },
    brief: null,
    ...overrides,
  };
}

const TASK: TodayTaskItem = {
  id: ID,
  title: "Pay rent",
  due_at: "2026-09-14T14:00:00.000Z",
  remind_at: null,
  timezone: "America/Chicago",
  priority: 1,
  project_id: null,
  project_name: null,
  rrule: null,
  parent_task_id: null,
  occurrence_id: null,
  snoozed_until: null,
};

const presetOf = (q: string) => askPresetOf(q)?.key ?? null;

const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** No reminders at all -- a cached list that genuinely holds nothing. */
const NO_REMINDERS: RemindersResponse = { items: [], horizon_days: 45 };

/** The default call: a cached reminders list with nothing in it, at a fixed now. */
const empty = (today: TodayResponse | undefined) => isTodayEmpty(today, NO_REMINDERS, NOW);

function reminders(...at: string[]): RemindersResponse {
  return {
    horizon_days: 45,
    items: at.map((remind_at, index) => ({
      key: `task:${index}`,
      task_id: ID,
      occurrence_id: null,
      title: "Renew the insurance",
      remind_at,
      due_at: null,
      timezone: "America/Chicago",
      recurring: false,
    })),
  };
}

describe("isTodayEmpty", () => {
  it("is FALSE when nothing has loaded -- 'nothing' is never asserted from ignorance", () => {
    expect(empty(undefined)).toBe(false);
  });

  it("is true for a fully empty day", () => {
    expect(empty(emptyToday())).toBe(true);
  });

  it("is false when any section has an item", () => {
    expect(
      empty(
        emptyToday({
          overdue: { items: [TASK], total: 1 },
          summary: { ...emptyToday().summary, overdue_total: 1 },
        }),
      ),
    ).toBe(false);
    expect(empty(emptyToday({ due_today: { items: [TASK], total: 1 } }))).toBe(false);
    expect(
      empty(
        emptyToday({
          events_today: {
            items: [
              {
                id: ID,
                title: "Standup",
                starts_at: "2026-09-14T14:30:00.000Z",
                ends_at: "2026-09-14T15:00:00.000Z",
                all_day: false,
                start_date: null,
                end_date: null,
                location: null,
                project_id: null,
                rrule: null,
                parent_event_id: null,
                occurs_at: null,
              },
            ],
          },
        }),
      ),
    ).toBe(false);
    expect(
      empty(
        emptyToday({
          upcoming: {
            days: [{ date: "2026-09-15", tasks: [TASK], events: [], total: 1 }],
          },
        }),
      ),
    ).toBe(false);
    expect(
      empty(
        emptyToday({
          inbox: {
            pending_count: 0,
            needs_confirm_count: 0,
            failed_count: 0,
            items: [
              {
                id: ID,
                raw_text: "call the insurance guy",
                status: "needs_confirm",
                captured_at: "2026-09-14T12:00:00.000Z",
                entity_type: null,
              },
            ],
          },
        }),
      ),
    ).toBe(false);
  });

  it("is false when a windowed section shows no items but its honest total is positive", () => {
    expect(empty(emptyToday({ overdue: { items: [], total: 3 } }))).toBe(false);
    expect(
      empty(
        emptyToday({
          upcoming: { days: [{ date: "2026-09-15", tasks: [], events: [], total: 2 }] },
        }),
      ),
    ).toBe(false);
  });

  it("is false when a summary counter is positive on its own", () => {
    const base = emptyToday().summary;
    expect(empty(emptyToday({ summary: { ...base, overdue_total: 1 } }))).toBe(false);
    expect(empty(emptyToday({ summary: { ...base, due_today_total: 1 } }))).toBe(false);
    expect(empty(emptyToday({ summary: { ...base, inbox_attention_total: 1 } }))).toBe(
      false,
    );
  });

  it("is false when captures are waiting even with no item rows on the wire", () => {
    const inbox = emptyToday().inbox;
    expect(empty(emptyToday({ inbox: { ...inbox, pending_count: 1 } }))).toBe(false);
    expect(empty(emptyToday({ inbox: { ...inbox, needs_confirm_count: 1 } }))).toBe(false);
    expect(empty(emptyToday({ inbox: { ...inbox, failed_count: 1 } }))).toBe(false);
  });

  it("ignores projects and reviews -- neither is due, scheduled or waiting", () => {
    const base = emptyToday();
    expect(
      empty(
        emptyToday({
          summary: { ...base.summary, active_project_count: 3 },
          projects: { active_count: 3, items: [] },
          reviews: {
            ...base.reviews,
            daily: { ...base.reviews.daily, status: "in_progress" as never },
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("planAskSubmission -- the one decision behind every Ask", () => {
  it("a preset on an empty day is answered locally and sends NOTHING", () => {
    for (const preset of ASK_PRESETS) {
      expect(planAskSubmission(preset.question, emptyToday(), presetOf, NO_REMINDERS, NOW)).toEqual({
        kind: "nothing_today",
        preset: preset.key,
      });
    }
  });

  it("a preset on a non-empty day is sent with scope 'today' -- never a note/task body", () => {
    const today = emptyToday({ due_today: { items: [TASK], total: 1 } });
    for (const preset of ASK_PRESETS) {
      expect(planAskSubmission(preset.question, today, presetOf, NO_REMINDERS, NOW)).toEqual({
        kind: "send",
        question: preset.question,
        scope: "today",
      });
    }
  });

  it("a preset before Today has loaded is sent (the cache cannot vouch for an empty day)", () => {
    expect(planAskSubmission(ASK_PRESETS[0]!.question, undefined, presetOf, NO_REMINDERS, NOW)).toEqual({
      kind: "send",
      question: ASK_PRESETS[0]!.question,
      scope: "today",
    });
  });

  it("free text is ALWAYS sent with scope 'both', even on an empty day", () => {
    expect(planAskSubmission("where did I put the warranty?", emptyToday(), presetOf, NO_REMINDERS, NOW)).toEqual({
      kind: "send",
      question: "where did I put the warranty?",
      scope: "both",
    });
  });

  it("one edited character turns a preset into free text", () => {
    const edited = `${ASK_PRESETS[0]!.question} please`;
    expect(planAskSubmission(edited, emptyToday(), presetOf, NO_REMINDERS, NOW)).toEqual({
      kind: "send",
      question: edited,
      scope: "both",
    });
  });
});

describe("hasReminderWithinHorizon (Checkpoint 9.7 review)", () => {
  it("cannot vouch either way with no cached list", () => {
    expect(hasReminderWithinHorizon(undefined, NOW)).toBeUndefined();
  });

  it("is false for an empty cached list, and for one whose reminders sit outside the window", () => {
    expect(hasReminderWithinHorizon(NO_REMINDERS, NOW)).toBe(false);
    const outside = reminders(
      new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
      new Date(NOW + (ASK_REMINDER_HORIZON_DAYS + 1) * DAY).toISOString(),
    );
    expect(hasReminderWithinHorizon(outside, NOW)).toBe(false);
  });

  it("is true for a reminder inside the seven-day window, including the grace hour", () => {
    expect(hasReminderWithinHorizon(reminders(new Date(NOW + 3 * DAY).toISOString()), NOW)).toBe(
      true,
    );
    expect(
      hasReminderWithinHorizon(reminders(new Date(NOW - 30 * 60 * 1000).toISOString()), NOW),
    ).toBe(true);
    expect(
      hasReminderWithinHorizon(
        reminders(new Date(NOW + ASK_REMINDER_HORIZON_DAYS * DAY).toISOString()),
        NOW,
      ),
    ).toBe(true);
  });

  it("ignores an unparseable instant rather than counting it", () => {
    expect(hasReminderWithinHorizon(reminders("not-a-date"), NOW)).toBe(false);
  });
});

describe("isTodayEmpty -- reminders inside the 7-day horizon (Checkpoint 9.7 review)", () => {
  it("is FALSE when a reminder falls in the window even though every Today section is empty", () => {
    // The exact case /today cannot show: a task due next month whose reminder
    // is tomorrow evening. The server's context WOULD list it.
    const soon = reminders(new Date(NOW + 1.5 * DAY).toISOString());
    expect(isTodayEmpty(emptyToday(), soon, NOW)).toBe(false);
  });

  it("is FALSE when the reminders cache is absent -- same rule as an unloaded /today", () => {
    expect(isTodayEmpty(emptyToday(), undefined, NOW)).toBe(false);
  });

  it("is true when the cached reminders all sit beyond the horizon", () => {
    const later = reminders(new Date(NOW + 30 * DAY).toISOString());
    expect(isTodayEmpty(emptyToday(), later, NOW)).toBe(true);
  });
});

describe("planAskSubmission -- reminders and the answered preset", () => {
  it("a preset is SENT when a reminder sits in the window, even on an otherwise empty day", () => {
    const soon = reminders(new Date(NOW + 2 * DAY).toISOString());
    expect(
      planAskSubmission(ASK_PRESETS[2]!.question, emptyToday(), presetOf, soon, NOW),
    ).toEqual({
      kind: "send",
      question: ASK_PRESETS[2]!.question,
      scope: "today",
    });
  });

  it("a preset is SENT when the reminders cache has not loaded", () => {
    expect(
      planAskSubmission(ASK_PRESETS[0]!.question, emptyToday(), presetOf, undefined, NOW),
    ).toEqual({
      kind: "send",
      question: ASK_PRESETS[0]!.question,
      scope: "today",
    });
  });

  it("names WHICH preset was answered locally, so the copy can speak about its window", () => {
    expect(
      planAskSubmission(ASK_PRESETS[2]!.question, emptyToday(), presetOf, NO_REMINDERS, NOW),
    ).toEqual({ kind: "nothing_today", preset: "tomorrow" });
  });
});
