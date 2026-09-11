import type { AskSource } from "@personal-os/schema";
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

  it("IGNORES the model-influenced title entirely when choosing a destination", () => {
    // The model that produced the answer was never given these ids (they are
    // attached server-side after the fact), and the title is echoed straight
    // from the user's own record -- but even so, navigation must be derived
    // only from the closed `type` union and the uuid, never from text.
    const hostile: AskSource = { ref: 1, type: "task", id: ID, title: "/settings" };
    expect(askSourceHref(hostile)).toBe(`/tasks/${ID}`);
  });
});
