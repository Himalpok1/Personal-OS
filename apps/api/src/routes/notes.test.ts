import { notes } from "@personal-os/db";
import {
  ENTITY_TITLE_MAX_CHARS,
  NOTE_BODY_MAX_CHARS,
  tooLongMessage,
  type Note,
} from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody, Paginated } from "../test/types.js";

describe("notes routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  it("creates, lists, gets, and updates a note", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/notes",
      payload: { title: "Idea", body: "build a widget" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<Note>().id;

    const list = await app.inject({ method: "GET", url: "/notes" });
    expect(list.json<Paginated<Note>>().total).toBe(1);

    const patched = await app.inject({
      method: "PATCH",
      url: `/notes/${id}`,
      payload: { body: "build a better widget" },
    });
    expect(patched.json<Note>().body).toBe("build a better widget");
  });

  it("rejects an unknown field with 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/notes",
      payload: { title: "bad", body: "x", archived_at: new Date().toISOString() },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an invalid boolean query parameter with 400", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/notes?include_archived=no",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "validation_failed" });
  });

  it("archive hides from default list without deleting the row", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/notes",
      payload: { title: "Archive me", body: "..." },
    });
    const id = created.json<Note>().id;

    await app.inject({ method: "POST", url: `/notes/${id}/archive` });

    const defaultList = await app.inject({ method: "GET", url: "/notes" });
    expect(defaultList.json<Paginated<Note>>().total).toBe(0);

    const includeArchived = await app.inject({
      method: "GET",
      url: "/notes?include_archived=true",
    });
    expect(includeArchived.json<Paginated<Note>>().total).toBe(1);

    const [row] = await app.db.select().from(notes).where(eq(notes.id, id));
    expect(row).toBeDefined();
  });

  it("404s for an unknown id", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/notes/00000000-0000-0000-0000-000000000000",
    });
    expect(response.statusCode).toBe(404);
  });

  // Checkpoint 9.6 (ADR-065): user-typed text over a bound is REFUSED with
  // the field path -- never truncated -- and exactly-at-bound is accepted.
  describe("content bounds", () => {
    // The issue shape Zod emits; only the pieces these tests key on.
    type Issue = { path: (string | number)[]; message: string };

    it("refuses a body over NOTE_BODY_MAX_CHARS with 400 naming the field", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/notes",
        payload: { title: "Long", body: "b".repeat(NOTE_BODY_MAX_CHARS + 1) },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json<ErrorBody>();
      expect(body.error).toBe("validation_failed");
      expect((body.issues as Issue[])[0]?.path).toEqual(["body"]);
      expect((body.issues as Issue[])[0]?.message).toBe(
        tooLongMessage("body", NOTE_BODY_MAX_CHARS),
      );
    });

    it("refuses a title over ENTITY_TITLE_MAX_CHARS on PATCH, leaving the row untouched", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/notes",
        payload: { title: "Keep", body: "x" },
      });
      const id = created.json<Note>().id;
      const response = await app.inject({
        method: "PATCH",
        url: `/notes/${id}`,
        payload: { title: "t".repeat(ENTITY_TITLE_MAX_CHARS + 1) },
      });
      expect(response.statusCode).toBe(400);
      expect((response.json<ErrorBody>().issues as Issue[])[0]?.path).toEqual(["title"]);
      const after = await app.inject({ method: "GET", url: `/notes/${id}` });
      expect(after.json<Note>().title).toBe("Keep");
    });

    it("accepts a title and body exactly at their bounds, byte-identical", async () => {
      const title = "e".repeat(ENTITY_TITLE_MAX_CHARS);
      const body = "b".repeat(NOTE_BODY_MAX_CHARS);
      const response = await app.inject({
        method: "POST",
        url: "/notes",
        payload: { title, body },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<Note>().title).toBe(title);
      expect(response.json<Note>().body).toBe(body);
    });
  });
});
