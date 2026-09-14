import type { SearchDateFilter, SearchResult } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  SEARCH_DATE_IGNORED_COPY,
  SEARCH_PARTIAL_MATCHES_COPY,
  searchDateFilterChip,
  searchEventDateLine,
  searchIgnoredTokensLine,
  searchMatchModeBanner,
  searchProjectStatusLine,
  searchTaskStatusLine,
} from "./search-labels";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "t",
  preview: null,
  timestamp: "2026-08-01T00:00:00.000Z",
  score: 0,
  match: { reasons: [], fields: [] },
};

function event(
  overrides: Partial<Extract<SearchResult, { type: "event" }>>,
): Extract<SearchResult, { type: "event" }> {
  return {
    ...base,
    type: "event",
    origin: "local",
    all_day: false,
    starts_at: "2026-09-18T12:46:00.000Z",
    start_date: null,
    is_recurring: false,
    is_detached: false,
    archived: false,
    ...overrides,
  };
}

function filter(overrides: Partial<SearchDateFilter>): SearchDateFilter {
  return {
    token: "september",
    kind: "month",
    from: "2026-09-01",
    to: "2026-09-30",
    tz: "America/Chicago",
    dropped: false,
    ...overrides,
  };
}

describe("searchMatchModeBanner", () => {
  it("explains ONLY the partial-match rung; the others need no banner", () => {
    expect(searchMatchModeBanner("any")).toBe(SEARCH_PARTIAL_MATCHES_COPY);
    expect(searchMatchModeBanner("all")).toBeNull();
    expect(searchMatchModeBanner("all_without_date")).toBeNull();
    expect(searchMatchModeBanner("none")).toBeNull();
  });

  it("pins the exact copy", () => {
    expect(SEARCH_PARTIAL_MATCHES_COPY).toBe("No exact matches — showing partial matches");
  });
});

describe("searchDateFilterChip", () => {
  it("is null when the query carried no date token", () => {
    expect(searchDateFilterChip(null)).toBeNull();
  });

  it("says the date was ignored when the server dropped it, instead of describing an unused window", () => {
    expect(searchDateFilterChip(filter({ dropped: true }))).toBe(SEARCH_DATE_IGNORED_COPY);
    expect(SEARCH_DATE_IGNORED_COPY).toBe("Date ignored — no matches in that range");
  });

  it("renders a month window as 'In <Month> <year>', so a year-less token shows the year the server chose", () => {
    const chip = searchDateFilterChip(filter({ kind: "month" }));
    expect(chip).toMatch(/^In /);
    expect(chip).toContain("2026");
    expect(chip).toMatch(/Sep/);
    expect(searchDateFilterChip(filter({ kind: "iso_month", token: "2026-09" }))).toBe(chip);
  });

  it("renders a day window as 'On <date>' using the LOCAL calendar date, never a UTC-shifted one", () => {
    // 2026-09-01 parsed as UTC midnight would read as Aug 31 west of Greenwich;
    // the local-date helpers keep it on the 1st in every zone.
    const chip = searchDateFilterChip(
      filter({ kind: "day", from: "2026-09-01", to: "2026-09-01" }),
    );
    expect(chip).toMatch(/^On /);
    expect(chip).toContain("1");
    expect(chip).not.toContain("31");
    expect(chip).toContain("2026");
    expect(
      searchDateFilterChip(filter({ kind: "iso_date", from: "2026-09-01", to: "2026-09-01" })),
    ).toBe(chip);
  });

  it("renders a year window as 'In <year>'", () => {
    expect(
      searchDateFilterChip(filter({ kind: "year", from: "2025-01-01", to: "2025-12-31" })),
    ).toBe("In 2025");
  });
});

describe("searchEventDateLine", () => {
  it("ALL-DAY: shows start_date as a calendar date and NEVER a clock time (ADR-045)", () => {
    // starts_at is deliberately non-null here: even if a caller hands over the
    // recurrence engine's local-noon anchor, all_day must win before any
    // instant is touched.
    const line = searchEventDateLine(
      event({ all_day: true, start_date: "2026-09-21", starts_at: "2026-09-21T17:00:00.000Z" }),
    );
    expect(line).not.toBeNull();
    expect(line).toContain("21");
    expect(line).toContain("2026");
    expect(line).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("ALL-DAY with no start_date: nothing rather than an invented instant", () => {
    expect(searchEventDateLine(event({ all_day: true, start_date: null }))).toBeNull();
  });

  it("TIMED: shows the start instant as a device-local date and time", () => {
    const line = searchEventDateLine(event({}));
    expect(line).toMatch(/\d{1,2}:\d{2}/);
    expect(line).toContain("2026");
    expect(line).not.toContain("repeats");
  });

  it("TIMED series parent: marks the row as repeating", () => {
    expect(searchEventDateLine(event({ is_recurring: true }))).toMatch(/· repeats$/);
  });

  it("TIMED with no starts_at: nothing", () => {
    expect(searchEventDateLine(event({ starts_at: null }))).toBeNull();
  });
});

describe("searchTaskStatusLine / searchProjectStatusLine", () => {
  it("names a closed task and says nothing about an open one", () => {
    const task = (status: Extract<SearchResult, { type: "task" }>["status"]) =>
      searchTaskStatusLine({ ...base, type: "task", status, archived: false });
    expect(task("done")).toBe("Done");
    expect(task("dropped")).toBe("Dropped");
    expect(task("active")).toBeNull();
    expect(task("inbox")).toBeNull();
  });

  it("names a paused or completed project and says nothing about an active one", () => {
    const project = (status: Extract<SearchResult, { type: "project" }>["status"]) =>
      searchProjectStatusLine({
        ...base,
        type: "project",
        status,
        target_date: null,
        archived: false,
      });
    expect(project("paused")).toBe("Paused");
    expect(project("completed")).toBe("Completed");
    expect(project("active")).toBeNull();
  });
});

describe("searchIgnoredTokensLine", () => {
  it("is null when the server dropped nothing", () => {
    expect(searchIgnoredTokensLine([])).toBeNull();
  });

  it("lists the dropped query tokens in the order the server echoed them", () => {
    expect(searchIgnoredTokensLine(["ninth", "tenth"])).toBe("Ignored: ninth, tenth");
    expect(searchIgnoredTokensLine(["x"])).toBe("Ignored: x");
  });
});
