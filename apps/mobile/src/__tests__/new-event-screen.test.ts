import { describe, expect, it } from "vitest";

// app/events/new.tsx's default export is a hooked screen (useState,
// useRouter, react-query) and this app has no render harness, so -- as
// components/quick-add-fab.test.ts does for the capture composer -- the
// wiring that matters is pinned by reading the module's source. The
// hook-free NewEventView and the pure event-form-state.ts carry the
// behaviour and are tested directly.
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string, o: Record<string, unknown>) => Record<string, string>;
  }
).glob("../app/**/*.tsx", { query: "?raw", import: "default", eager: true });

const newEvent = SOURCES["../app/events/new.tsx"]!;
const editEvent = SOURCES["../app/events/[id].tsx"]!;
const today = SOURCES["../app/(tabs)/index.tsx"]!;

describe("app/events/new.tsx (Checkpoint 9.5)", () => {
  it("mints client_uuid ONCE per mount and sends it on every attempt", () => {
    expect(newEvent).toMatch(
      /const \[idempotency, setIdempotency\] = useState\(\(\) => initialClientUuidState\(randomUUID\)\)/,
    );
    expect(newEvent).toMatch(
      /\{ clientUuid: idempotency\.clientUuid, timezone, recurrence: serialized \}/,
    );
    // Never a fresh uuid inside submit: only the pure state transition mints.
    const submitBody = newEvent.slice(newEvent.indexOf("const submit = () => {"));
    expect(submitBody).not.toContain("randomUUID");
    expect(submitBody).not.toContain("initialClientUuidState");
  });

  it("regenerates client_uuid only for an edit AFTER a failed attempt, through every field setter", () => {
    // The failure is recorded in onError; the regeneration happens in the
    // field setters (event-form-state.ts's pure transition), so an unchanged
    // retry reuses the uuid and an edited retry is a new intent.
    expect(newEvent).toMatch(/onError: \(error\) => \{\s*setIdempotency\(markAttemptFailed\);/);
    expect(newEvent).toMatch(
      /const noteEdit = \(\) =>\s*setIdempotency\(\(state\) => nextClientUuidAfterEdit\(state, randomUUID\)\)/,
    );
    const view = newEvent.slice(newEvent.indexOf("<NewEventView"));
    for (const prop of [
      "onTitleChange",
      "onDescriptionChange",
      "onLocationChange",
      "onAllDayChange",
      "onEndsAtChange",
      "onEndDateChange",
      "onRecurrenceChange",
      "onCalendarChange",
      "onProjectIdChange",
    ]) {
      expect(view, prop).toMatch(new RegExp(`${prop}=\\{edited\\(`));
    }
    // The two start handlers have bodies of their own and call noteEdit first.
    expect(newEvent).toMatch(
      /const onStartsAtChange = \(value: string \| null\) => \{\s*noteEdit\(\);/,
    );
    expect(newEvent).toMatch(
      /const onStartDateChange = \(value: string \| null\) => \{\s*noteEdit\(\);/,
    );
  });

  it("surfaces a failed calendar-targets query as a note and never blocks creation", () => {
    expect(newEvent).toMatch(
      /const \{ targets: calendarTargets, isError: calendarTargetsError \} = useCalendarTargets\(\);/,
    );
    expect(newEvent).toMatch(/calendarTargetsError=\{calendarTargetsError\}/);
    // The Create button's disabled condition does not read the targets query.
    expect(newEvent).toMatch(/disabled=\{props\.isSubmitting \|\| !props\.title\.trim\(\)\}/);
  });

  it("catches a serializer throw as a form error rather than an unhandled throw", () => {
    expect(newEvent).toMatch(
      /try \{\s*serialized = serializeEditorStateToRRule\(recurrence\);\s*\} catch \{\s*setFormError\("That repeat rule isn't supported\."\);/,
    );
  });

  it("the calendar travels in the POST body; the post-create link flow is gone", () => {
    expect(newEvent).toContain("useCalendarTargets");
    expect(newEvent).toContain("buildEventCreateBody");
    expect(newEvent).not.toContain("linkToGoogleCalendar");
    expect(newEvent).not.toContain("GoogleCalendarLinkPicker");
    expect(newEvent).not.toContain("link-google-calendar");
  });

  it("sends the device zone and re-derives Weekly/Monthly from the start's own onChange, never an effect", () => {
    expect(newEvent).toMatch(/const timezone = deviceTimezone\(\);/);
    expect(newEvent).toContain("applyEventStartChange(");
    expect(newEvent).not.toContain("useEffect");
  });

  it("keeps the pre-fill params", () => {
    for (const param of ["date", "startsAt", "endsAt", "allDay", "projectId"]) {
      expect(newEvent).toMatch(new RegExp(`\\b${param}\\?: string;`));
    }
  });
});

describe("app/events/[id].tsx (Checkpoint 9.5)", () => {
  it("routes an external event to the read-only view before any editor state is offered", () => {
    expect(editEvent).toMatch(/const isExternal = event\?\.origin === "external";/);
    expect(editEvent).toMatch(/if \(isExternal\) \{\s*return \(\s*<ExternalEventView/);
  });

  it("opens the occurrence modal for LOCAL series only", () => {
    expect(editEvent).toMatch(/Boolean\(occursAt && isRecurring && event\?\.origin === "local"\)/);
    expect(editEvent).toMatch(
      /if \(event && occursAt && isRecurring && event\.origin === "local"\)/,
    );
  });

  it("seeds timed fields in the event's zone, not as raw UTC", () => {
    expect(editEvent).toMatch(/startsAt: seedInstant\(event\.starts_at, event\.timezone\)/);
    expect(editEvent).toMatch(/formatInstantWithOffset\(instant, timezone\)/);
  });

  it("Delete confirms, then archives, then navigates back; every mutation reports through one classifier", () => {
    expect(editEvent).toMatch(
      /title: "Delete this event\?"[\s\S]*?archiveEvent\.mutate\(event\.id, \{\s*onSuccess: \(\) => router\.back\(\)/,
    );
    // Checkpoint 9.6: the one-call line carries the field-level validation
    // message (event-form-state.ts's eventMutationErrorLine) so an
    // over-bound title is named rather than blamed on the dates.
    expect(editEvent).toMatch(
      /const failWith = \(verb: string\) => \(err: unknown\) =>\s*setErrorMessage\(eventMutationErrorLine\(err, verb\)\)/,
    );
    for (const verb of [
      "save those changes",
      "save this occurrence",
      "cancel this occurrence",
      "delete this event",
      "link this event",
    ]) {
      expect(editEvent).toContain(`failWith("${verb}")`);
    }
  });

  it("never enters occurrence edit mode for a linked series (the modal hides it; the screen guards it)", () => {
    expect(editEvent).toMatch(
      /const handleSelectEditOccurrence = \(\) => \{\s*setModalVisible\(false\);[\s\S]*?if \(event\.sync !== null\) return;\s*setEditMode\("occurrence"\);/,
    );
  });

  it("passes the calendar-targets error through to the edit view", () => {
    expect(editEvent).toMatch(
      /const \{ targets: calendarTargets, isError: calendarTargetsError \} = useCalendarTargets\(\);/,
    );
    expect(editEvent).toMatch(/calendarTargetsError=\{calendarTargetsError\}/);
  });

  it("links through the calendar-targets list, never the Google-only picker", () => {
    expect(editEvent).toContain("useLinkEventToCalendar");
    expect(editEvent).toContain("toCalendarBody(linkTarget)");
    expect(editEvent).not.toContain("GoogleCalendarLinkPicker");
  });
});

describe("Today (Checkpoint 9.5)", () => {
  it("EventRow passes occurs_at for recurring instances through the shared href helper", () => {
    expect(today).toMatch(
      /function EventRow\(\{ event \}: \{ event: TodayEventItem \}\)[\s\S]*?router\.push\(eventDetailHref\(event\.id, event\.occurs_at\) as Href\)/,
    );
    expect(today).not.toMatch(/router\.push\(`\/events\/\$\{event\.id\}`\)/);
  });

  it("offers a '+ Event' header action beside 'All tasks'", () => {
    expect(today).toMatch(/<Link href="\/events\/new" asChild>[\s\S]*?\+ Event/);
  });
});
