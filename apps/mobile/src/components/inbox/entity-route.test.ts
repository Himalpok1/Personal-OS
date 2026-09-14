import { describe, expect, it } from "vitest";
import { entityRoute } from "./entity-route";

const ID = "22222222-2222-4222-8222-222222222222";

describe("entityRoute", () => {
  it("maps each committed entity type to its detail screen", () => {
    expect(entityRoute({ entity_type: "task", entity_id: ID })).toBe(`/tasks/${ID}`);
    expect(entityRoute({ entity_type: "note", entity_id: ID })).toBe(`/notes/${ID}`);
    expect(entityRoute({ entity_type: "event", entity_id: ID })).toBe(`/events/${ID}`);
  });

  it("is null for an item that has not been committed", () => {
    expect(entityRoute({ entity_type: null, entity_id: null })).toBeNull();
  });

  it("is null when the pair is half-written -- a type without an id, or an id without a type", () => {
    expect(entityRoute({ entity_type: "task", entity_id: null })).toBeNull();
    expect(entityRoute({ entity_type: "task", entity_id: "" })).toBeNull();
    expect(entityRoute({ entity_type: null, entity_id: ID })).toBeNull();
  });
});
