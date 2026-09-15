import type { AskSource, AskSourceType } from "@personal-os/schema";
import { AskSourceTypeSchema } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { askSourceHref } from "./ask-navigation";

const ID = "11111111-1111-4111-8111-111111111111";

describe("askSourceHref", () => {
  it("routes a task source to its detail screen", () => {
    const source: AskSource = { ref: 1, type: "task", id: ID, title: "Renew the insurance" };
    expect(askSourceHref(source)).toBe(`/tasks/${ID}`);
  });

  it("routes a note source to its detail screen", () => {
    const source: AskSource = { ref: 2, type: "note", id: ID, title: "Recipe idea" };
    expect(askSourceHref(source)).toBe(`/notes/${ID}`);
  });

  it("routes an event INSTANCE through eventDetailHref with its occurs_at (Checkpoint 9.7)", () => {
    const source: AskSource = {
      ref: 3,
      type: "event",
      id: ID,
      title: "Standup",
      section: "event",
      occurs_at: "2026-09-14T14:30:00.000Z",
    };
    expect(askSourceHref(source)).toBe(
      `/events/${ID}?occursAt=${encodeURIComponent("2026-09-14T14:30:00.000Z")}`,
    );
  });

  it("routes a one-off event (null or absent occurs_at) to the plain detail route", () => {
    const withNull: AskSource = {
      ref: 3,
      type: "event",
      id: ID,
      title: "Dentist",
      occurs_at: null,
    };
    const absent: AskSource = { ref: 3, type: "event", id: ID, title: "Dentist" };
    expect(askSourceHref(withNull)).toBe(`/events/${ID}`);
    expect(askSourceHref(absent)).toBe(`/events/${ID}`);
  });

  it("routes an inbox source to the capture's own screen, never to a guessed entity", () => {
    const source: AskSource = {
      ref: 4,
      type: "inbox_item",
      id: ID,
      title: "call the insurance guy",
      section: "capture",
    };
    expect(askSourceHref(source)).toBe(`/inbox/${ID}`);
  });

  it("covers every member of AskSourceTypeSchema -- a new type cannot be forgotten", () => {
    for (const type of AskSourceTypeSchema.options satisfies readonly AskSourceType[]) {
      const href = askSourceHref({ ref: 1, type, id: ID, title: "x" });
      expect(typeof href).toBe("string");
      expect(String(href).startsWith("/")).toBe(true);
    }
  });

  it("IGNORES the model-influenced title and detail entirely when choosing a destination", () => {
    // The model that produced the answer was never given these ids (they are
    // attached server-side after the fact), and the title is echoed straight
    // from the user's own record -- but even so, navigation must be derived
    // only from the closed `type` union, the uuid and the server-formatted
    // instant, never from text.
    const hostile: AskSource = {
      ref: 1,
      type: "task",
      id: ID,
      title: "/settings",
      detail: "../settings",
    };
    expect(askSourceHref(hostile)).toBe(`/tasks/${ID}`);
    const hostileEvent: AskSource = {
      ref: 1,
      type: "event",
      id: ID,
      title: "?occursAt=evil",
      occurs_at: null,
    };
    expect(askSourceHref(hostileEvent)).toBe(`/events/${ID}`);
  });
});
