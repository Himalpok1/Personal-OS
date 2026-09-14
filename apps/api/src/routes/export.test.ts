import {
  aiProviderConnections,
  devices,
  events,
  healthConnections,
  inboxItems,
  mailConnections,
  mailMessages,
  notes,
  projects,
  tasks,
} from "@personal-os/db";
import { ExportResponseSchema, type ExportResponse } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

const TZ = "America/Chicago";

// Values that must NEVER appear in an export body. Each is planted in a real
// row by `seedForbiddenNeighbours` below, so these assertions test the export's
// SCOPE rather than merely the absence of a substring that was never there.
const SECRET_TOKEN_HASH = "c0ffee-device-token-hash-do-not-export";
const SECRET_PUSH_TOKEN = "ExponentPushToken[do-not-export-xxxxx]";
const SECRET_MAIL_ACCOUNT = "owner+secret@gmail.example";
const SECRET_HEALTH_USER = "health-user-id-do-not-export";
const SECRET_AI_PROVIDER = "provider-name-do-not-export";
const SECRET_MAIL_SUBJECT = "third-party subject do-not-export";
const SECRET_EVENT_TITLE = "stranger-authored event do-not-export";

describe("GET /export", () => {
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

  function get() {
    return app.inject({ method: "GET", url: "/export" });
  }

  async function exportBody(): Promise<ExportResponse> {
    const response = await get();
    expect(response.statusCode).toBe(200);
    return ExportResponseSchema.parse(response.json());
  }

  /**
   * Populates every category the export must NOT reach: credential columns,
   * provider tokens, AI configuration, third-party mail metadata and
   * stranger-authored calendar text.
   */
  async function seedForbiddenNeighbours(): Promise<void> {
    await app.db.insert(devices).values({
      name: "Rabbit",
      platform: "android",
      tokenHash: SECRET_TOKEN_HASH,
      pushToken: SECRET_PUSH_TOKEN,
    });
    await app.db.insert(aiProviderConnections).values({
      name: SECRET_AI_PROVIDER,
      providerType: "openai_compatible",
      baseUrl: "https://example.invalid/v1",
      apiKeyCiphertext: Buffer.from("ciphertext-do-not-export"),
      apiKeyIv: Buffer.from("iv-do-not-export"),
      apiKeyAuthTag: Buffer.from("authtag-do-not-export"),
    });
    await app.db.insert(healthConnections).values({
      provider: "google_health",
      healthUserId: SECRET_HEALTH_USER,
    });
    const [connection] = await app.db
      .insert(mailConnections)
      .values({
        provider: "gmail",
        externalAccountId: SECRET_MAIL_ACCOUNT,
        accessTokenCiphertext: Buffer.from("access-ciphertext-do-not-export"),
        accessTokenIv: Buffer.from("access-iv"),
        accessTokenAuthTag: Buffer.from("access-tag"),
        grantedScope: "https://www.googleapis.com/auth/gmail.metadata",
      })
      .returning({ id: mailConnections.id });
    await app.db.insert(mailMessages).values({
      connectionId: connection!.id,
      externalId: "msg-forbidden",
      threadId: "thread-forbidden",
      internalDate: new Date("2026-08-01T12:00:00Z"),
      subject: SECRET_MAIL_SUBJECT,
      fromAddress: "stranger@example.com",
      fromDomain: "example.com",
      fromDisplayName: "A Stranger",
      contentHash: "hash-forbidden",
    });
    await app.db.insert(events).values({
      title: SECRET_EVENT_TITLE,
      timezone: TZ,
      startsAt: new Date("2026-08-01T15:00:00Z"),
      endsAt: new Date("2026-08-01T16:00:00Z"),
      description: "conference link and passcode do-not-export",
      location: "somewhere do-not-export",
    });
  }

  // ---- shape --------------------------------------------------------

  it("returns a valid, stable envelope for an empty database", async () => {
    const body = await exportBody();
    expect(body.format_version).toBe(1);
    expect(body.scope).toBe("user_authored_core");
    expect(body.truncated).toBe(false);
    expect(body.projects).toEqual([]);
    expect(body.tasks).toEqual([]);
    expect(body.notes).toEqual([]);
    expect(body.inbox_items).toEqual([]);
    for (const counts of Object.values(body.counts)) {
      expect(counts).toEqual({ returned: 0, total: 0 });
    }
  });

  it("has exactly the declared top-level keys and no others", async () => {
    const response = await get();
    expect(Object.keys(response.json<Record<string, unknown>>()).sort()).toEqual([
      "counts",
      "format_version",
      "generated_at",
      "inbox_items",
      "notes",
      "projects",
      "scope",
      "tasks",
      "truncated",
    ]);
  });

  it("emits valid JSON with a JSON content type", async () => {
    const response = await get();
    expect(response.headers["content-type"]).toContain("application/json");
    expect(() => {
      // Braced so the `any` from JSON.parse is not returned out of the arrow.
      JSON.parse(response.body);
    }).not.toThrow();
    // Not a file handoff -- the caller decides whether the bytes become a file.
    expect(response.headers["content-disposition"]).toBeUndefined();
  });

  // ---- approved entities --------------------------------------------

  it("includes every approved entity with honest counts", async () => {
    const [project] = await app.db
      .insert(projects)
      .values({ name: "Roof replacement", goal: "watertight by winter" })
      .returning({ id: projects.id });
    await app.db.insert(tasks).values({
      title: "Call the roofer",
      body: "ask about the ridge",
      timezone: TZ,
      projectId: project!.id,
    });
    await app.db.insert(notes).values({ title: "Quotes", body: "three so far" });
    await app.db.insert(inboxItems).values({
      rawText: "remind me to chase the quote",
      source: "siri",
      capturedAt: new Date("2026-08-01T10:00:00Z"),
      timezone: TZ,
    });

    const body = await exportBody();
    expect(body.counts).toEqual({
      projects: { returned: 1, total: 1 },
      tasks: { returned: 1, total: 1 },
      notes: { returned: 1, total: 1 },
      inbox_items: { returned: 1, total: 1 },
    });
    expect(body.projects[0]!.name).toBe("Roof replacement");
    expect(body.tasks[0]!.title).toBe("Call the roofer");
    expect(body.tasks[0]!.body).toBe("ask about the ridge");
    expect(body.notes[0]!.body).toBe("three so far");
    expect(body.inbox_items[0]!.raw_text).toBe("remind me to chase the quote");
  });

  it("includes ARCHIVED rows -- an export is the copy that must not lose them", async () => {
    const archivedAt = new Date("2026-08-01T00:00:00Z");
    await app.db.insert(tasks).values({ title: "archived task", timezone: TZ, archivedAt });
    await app.db.insert(notes).values({ title: "archived note", body: "x", archivedAt });
    await app.db.insert(projects).values({ name: "archived project", archivedAt });

    const body = await exportBody();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]!.archived_at).not.toBeNull();
    expect(body.notes[0]!.archived_at).not.toBeNull();
    expect(body.projects[0]!.archived_at).not.toBeNull();
  });

  // Checkpoint 9.3: inbox_items gained an archive axis (migration 0017). The
  // export rule is ADR-059's -- archived rows are included unconditionally --
  // and GET /inbox's default exclusion must NOT leak into this surface.
  it("includes ARCHIVED inbox items too, counted honestly alongside live ones", async () => {
    await app.db.insert(inboxItems).values([
      {
        rawText: "live capture",
        source: "web",
        capturedAt: new Date("2026-08-01T10:00:00Z"),
        createdAt: new Date("2026-08-01T10:00:00Z"),
        timezone: TZ,
        status: "parsed",
      },
      {
        rawText: "archived capture",
        source: "web",
        capturedAt: new Date("2026-08-02T10:00:00Z"),
        createdAt: new Date("2026-08-02T10:00:00Z"),
        timezone: TZ,
        status: "failed",
        archivedAt: new Date("2026-09-10T00:00:00Z"),
      },
    ]);

    const body = await exportBody();
    expect(body.counts.inbox_items).toEqual({ returned: 2, total: 2 });
    expect(body.inbox_items.map((item) => item.raw_text)).toEqual([
      "live capture",
      "archived capture",
    ]);
  });

  it("orders each entity oldest-first with an id tie-break", async () => {
    const createdAt = new Date("2026-08-01T00:00:00Z");
    await app.db.insert(notes).values([
      { title: "tie a", body: "x", createdAt },
      { title: "tie b", body: "x", createdAt },
      { title: "tie c", body: "x", createdAt },
    ]);
    await app.db
      .insert(notes)
      .values({ title: "newest", body: "x", createdAt: new Date("2026-08-09T00:00:00Z") });

    const first = await exportBody();
    const ids = first.notes.map((note) => note.id);
    expect(first.notes.at(-1)!.title).toBe("newest");
    expect(ids.slice(0, 3)).toEqual([...ids.slice(0, 3)].sort());
    expect((await exportBody()).notes.map((note) => note.id)).toEqual(ids);
  });

  it("narrows inbox items to authored content, dropping machine artifacts", async () => {
    await app.db.insert(inboxItems).values({
      rawText: "captured text",
      source: "web",
      capturedAt: new Date("2026-08-01T10:00:00Z"),
      timezone: TZ,
      clientUuid: "11111111-2222-3333-4444-555555555555",
      parseResult: { tool: "create_note", args: { title: "x" } },
      confidence: 0.42,
      audioPath: "/tmp/personal-os-audio/private.m4a",
    });

    const response = await get();
    const body = ExportResponseSchema.parse(response.json());
    expect(Object.keys(body.inbox_items[0]!).sort()).toEqual([
      "archived_at",
      "captured_at",
      "created_at",
      "entity_id",
      "entity_type",
      "id",
      "raw_text",
      "source",
      "status",
      "timezone",
    ]);
    for (const forbidden of [
      "client_uuid",
      "11111111-2222-3333-4444-555555555555",
      "parse_result",
      "create_note",
      "confidence",
      "audio_path",
      "/tmp/personal-os-audio",
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
  });

  // ---- the allowlist ------------------------------------------------

  it("EXCLUDES every credential, provider token, AI config and third-party table", async () => {
    await seedForbiddenNeighbours();
    // Real user content alongside it, so a passing assertion cannot be an
    // artifact of an empty response.
    await app.db.insert(notes).values({ title: "mine", body: "my own words" });

    const response = await get();
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("my own words");

    for (const forbidden of [
      // credentials and tokens
      SECRET_TOKEN_HASH,
      SECRET_PUSH_TOKEN,
      "token_hash",
      "push_token",
      "ciphertext",
      "auth_tag",
      "api_key",
      "access_token",
      "refresh_token",
      "granted_scope",
      "gmail.metadata",
      "secret",
      "password",
      // AI configuration
      SECRET_AI_PROVIDER,
      "provider_type",
      "openai_compatible",
      "ai_provider",
      "ai_models",
      "model_id",
      // integration identity
      SECRET_MAIL_ACCOUNT,
      SECRET_HEALTH_USER,
      "external_account_id",
      "health_user_id",
      // third-party content
      SECRET_MAIL_SUBJECT,
      SECRET_EVENT_TITLE,
      "stranger@example.com",
      "do-not-export",
      // table names that would betray a widened scope
      "mail_messages",
      "health_",
      "monitor_",
      "notification_dispatch",
      "occurrences",
      "events",
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
  });

  it("keeps the allowlist to exactly four entity arrays", async () => {
    await seedForbiddenNeighbours();
    const body = await exportBody();
    const arrayKeys = Object.entries(body)
      .filter(([, value]) => Array.isArray(value))
      .map(([key]) => key)
      .sort();
    expect(arrayKeys).toEqual(["inbox_items", "notes", "projects", "tasks"]);
    expect(Object.keys(body.counts).sort()).toEqual(["inbox_items", "notes", "projects", "tasks"]);
  });

  it("emits only the frozen field set for tasks, notes and projects", async () => {
    await app.db.insert(projects).values({ name: "p" });
    await app.db.insert(tasks).values({ title: "t", timezone: TZ });
    await app.db.insert(notes).values({ title: "n", body: "b" });

    const body = await exportBody();
    expect(Object.keys(body.tasks[0]!).sort()).toEqual([
      "archived_at",
      "body",
      "completed_at",
      "created_at",
      "due_at",
      "id",
      "priority",
      "project_id",
      "recurrence_anchor",
      "recurrence_count",
      "recurrence_exdates",
      "recurrence_timezone",
      "recurrence_until",
      "remind_at",
      "rrule",
      "status",
      "timezone",
      "title",
      "updated_at",
    ]);
    expect(Object.keys(body.notes[0]!).sort()).toEqual([
      "archived_at",
      "body",
      "created_at",
      "id",
      "project_id",
      "title",
      "updated_at",
    ]);
    expect(Object.keys(body.projects[0]!).sort()).toEqual([
      "archived_at",
      "color",
      "completed_at",
      "created_at",
      "goal",
      "id",
      "name",
      "status",
      "target_date",
      "updated_at",
    ]);
  });

  it("stamps one generation instant for the whole document", async () => {
    const before = Date.now();
    const body = await exportBody();
    const generated = Date.parse(body.generated_at);
    expect(generated).toBeGreaterThanOrEqual(before - 1000);
    expect(generated).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
