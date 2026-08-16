import { notes } from "@personal-os/db";
import type { Note } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { Paginated } from "../test/types.js";

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
});
