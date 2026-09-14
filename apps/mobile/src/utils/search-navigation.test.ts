import type { SearchResult } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { SEARCH_RESULT_TYPE_ORDER } from "@personal-os/schema";
import { SEARCH_TYPE_CHIP_LABELS, SEARCH_TYPE_LABELS, searchResultHref } from "./search-navigation";

const ID = "11111111-1111-4111-8111-111111111111";
const ENTITY_ID = "22222222-2222-4222-8222-222222222222";

const base = {
  id: ID,
  title: "t",
  preview: null,
  timestamp: "2026-08-01T00:00:00.000Z",
  score: 0,
  match: { reasons: [], fields: [] },
};

describe("searchResultHref", () => {
  it("routes a task to its detail screen", () => {
    const result: SearchResult = { ...base, type: "task", status: "active", archived: false };
    expect(searchResultHref(result)).toBe(`/tasks/${ID}`);
  });

  it("routes a note to its detail screen", () => {
    const result: SearchResult = { ...base, type: "note", archived: false };
    expect(searchResultHref(result)).toBe(`/notes/${ID}`);
  });

  it("routes an event to its detail screen -- the plain route, never an ?occursAt= instance", () => {
    for (const shape of [
      { origin: "local", is_recurring: false, is_detached: false },
      { origin: "local", is_recurring: true, is_detached: false },
      { origin: "external", is_recurring: false, is_detached: true },
    ] as const) {
      const result: SearchResult = {
        ...base,
        type: "event",
        ...shape,
        all_day: false,
        starts_at: "2026-09-18T12:46:00.000Z",
        start_date: null,
        archived: false,
      };
      expect(searchResultHref(result)).toBe(`/events/${ID}`);
    }
  });

  it("routes a project to its detail screen", () => {
    const result: SearchResult = {
      ...base,
      type: "project",
      status: "active",
      target_date: null,
      archived: false,
    };
    expect(searchResultHref(result)).toBe(`/projects/${ID}`);
  });

  it("routes a committed inbox capture to the entity it became", () => {
    for (const [entityType, prefix] of [
      ["task", "/tasks/"],
      ["note", "/notes/"],
      ["event", "/events/"],
    ] as const) {
      const result: SearchResult = {
        ...base,
        type: "inbox_item",
        status: "confirmed",
        entity_type: entityType,
        entity_id: ENTITY_ID,
      };
      expect(searchResultHref(result)).toBe(`${prefix}${ENTITY_ID}`);
    }
  });

  it("routes an uncommitted inbox capture to its own detail screen", () => {
    const result: SearchResult = {
      ...base,
      type: "inbox_item",
      status: "pending",
      entity_type: null,
      entity_id: null,
    };
    expect(searchResultHref(result)).toBe(`/inbox/${base.id}`);
  });

  it("falls back to the capture's detail screen when entity_type is absent but an id is not", () => {
    const result: SearchResult = {
      ...base,
      type: "inbox_item",
      status: "parsed",
      entity_type: null,
      entity_id: ENTITY_ID,
    };
    expect(searchResultHref(result)).toBe(`/inbox/${base.id}`);
  });

  it("gives a mail result NO destination -- no per-message screen exists", () => {
    const result: SearchResult = {
      ...base,
      type: "mail_message",
      sender: null,
      has_attachment: false,
    };
    expect(searchResultHref(result)).toBeNull();
  });

  it("IGNORES attacker-authored text entirely when choosing a destination", () => {
    // The whole point of deriving from `type` + uuid: a subject or a display
    // name that looks like a route must not be able to become one.
    const hostile: SearchResult = {
      ...base,
      type: "mail_message",
      title: "/settings",
      preview: "https://evil.example/steal",
      timestamp: "2026-08-01T00:00:00.000Z",
      sender: "../../hardware-debug",
      has_attachment: false,
    };
    expect(searchResultHref(hostile)).toBeNull();

    const hostileTask: SearchResult = {
      ...base,
      id: ID,
      type: "task",
      title: "/settings",
      preview: "javascript:alert(1)",
      status: "active",
      archived: false,
    };
    // Derived from the uuid, not from anything in the strings.
    expect(searchResultHref(hostileTask)).toBe(`/tasks/${ID}`);
  });
});

describe("SEARCH_TYPE_LABELS / SEARCH_TYPE_CHIP_LABELS", () => {
  it("name every searchable type -- exactly the six in SEARCH_RESULT_TYPE_ORDER", () => {
    const expected = [...SEARCH_RESULT_TYPE_ORDER].sort();
    expect(Object.keys(SEARCH_TYPE_LABELS).sort()).toEqual(expected);
    expect(Object.keys(SEARCH_TYPE_CHIP_LABELS).sort()).toEqual(expected);
    expect(SEARCH_TYPE_LABELS.event).toBe("Events");
    expect(SEARCH_TYPE_LABELS.project).toBe("Projects");
    expect(SEARCH_TYPE_CHIP_LABELS.event).toBe("Event");
    expect(SEARCH_TYPE_CHIP_LABELS.project).toBe("Project");
  });
});
