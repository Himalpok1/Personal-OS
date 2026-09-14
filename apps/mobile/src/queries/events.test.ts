import { describe, expect, it } from "vitest";
import { EVENT_MUTATION_INVALIDATION_KEYS } from "./events";

// This app has no render harness and every mutation hook calls
// useQueryClient(), so -- as queries/monitor.test.ts does -- the invalidation
// contract is pinned by reading the modules' own source (via Vite's
// compile-time import.meta.glob, since apps/mobile's tsconfig excludes
// @types/node; see __tests__/routes-hygiene.test.ts).
const SOURCES = (
  import.meta as unknown as {
    glob: (p: string, o: Record<string, unknown>) => Record<string, string>;
  }
).glob("./*.ts", { query: "?raw", import: "default", eager: true });

const eventsSource = SOURCES["./events.ts"]!;
const calendarSource = SOURCES["./calendar-connections.ts"]!;

describe("event mutations refresh every read model an event appears in (Checkpoint 9.5)", () => {
  it("the shared key set covers the events caches, Today and the Agenda", () => {
    expect(EVENT_MUTATION_INVALIDATION_KEYS).toEqual([["events"], ["today"], ["agenda"]]);
  });

  it("useInvalidateEvents loops over exactly that set", () => {
    expect(eventsSource).toMatch(
      /function useInvalidateEvents\(\)[\s\S]*?for \(const queryKey of EVENT_MUTATION_INVALIDATION_KEYS\)[\s\S]*?invalidateQueries\(\{ queryKey \}\)/,
    );
  });

  it.each([
    "useCreateEvent",
    "useUpdateEvent",
    "useArchiveEvent",
    "useDetachEvent",
    "useCancelEventOccurrence",
  ])("%s wires onSuccess to the shared invalidation", (hook) => {
    const block = new RegExp(`export function ${hook}\\(\\)[\\s\\S]*?onSuccess: invalidate`);
    expect(eventsSource).toMatch(block);
  });

  it("useLinkEventToCalendar invalidates the same set, not just ['events']", () => {
    expect(calendarSource).toMatch(
      /export function useLinkEventToCalendar\(\)[\s\S]*?for \(const queryKey of EVENT_MUTATION_INVALIDATION_KEYS\)/,
    );
    // The Phase 4 Google-only linker, which invalidated ["events"] alone, is gone.
    expect(calendarSource).not.toContain("export function useLinkEventToGoogleCalendar");
    expect(calendarSource).not.toContain("export function useLinkableGoogleCalendars");
  });

  it("every calendar-connection mutation also invalidates the calendar-targets key", () => {
    // A calendar toggled on in Settings (or a connection connected /
    // disconnected / re-synced) changes what GET /calendar-targets returns;
    // without this the event screens offered a stale list until a relaunch.
    expect(calendarSource).toMatch(
      /export const CALENDAR_MUTATION_INVALIDATION_KEYS = \[connectionsKey, calendarTargetsKey\] as const;/,
    );
    expect(calendarSource).toMatch(
      /function useInvalidateCalendarConnections\(\)[\s\S]*?for \(const queryKey of CALENDAR_MUTATION_INVALIDATION_KEYS\)[\s\S]*?invalidateQueries\(\{ queryKey \}\)/,
    );
    for (const hook of [
      "useConnectGoogleCalendar",
      "useConnectCaldavCalendar",
      "useSyncCalendarConnectionNow",
      "useDisconnectCalendarConnection",
    ]) {
      expect(calendarSource, hook).toMatch(
        new RegExp(
          `export function ${hook}\\(\\)[\\s\\S]*?const invalidate = useInvalidateCalendarConnections\\(\\);[\\s\\S]*?onSuccess: invalidate`,
        ),
      );
    }
    expect(calendarSource).toMatch(
      /export function useUpdateCalendarConnectionCalendars\(\)[\s\S]*?for \(const queryKey of CALENDAR_MUTATION_INVALIDATION_KEYS\)[\s\S]*?invalidateQueries\(\{ queryKey \}\)/,
    );
  });

  it("useCalendarTargets reads GET /calendar-targets through the api-client", () => {
    expect(calendarSource).toMatch(
      /export function calendarTargetsQueryOptions\(\)[\s\S]*?queryFn: \(\) => api\.listCalendarTargets\(\)/,
    );
  });
});

describe("the UI-test event fixture carries the 9.5 ownership fields", () => {
  it("declares origin: local and sync: null (the literal is typed `Event`, so tsc pins the shape)", () => {
    const start = eventsSource.indexOf("const UI_TEST_EVENT: Event = {");
    const end = eventsSource.indexOf("};", start);
    const literal = eventsSource.slice(start, end);
    expect(literal).toMatch(/origin: "local",/);
    expect(literal).toMatch(/sync: null,/);
  });
});
