import { rm } from "node:fs/promises";
import { inboxItems } from "@personal-os/db";
import type { CaptureResponse } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../env.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

function buildTranscribeForm(
  overrides: Partial<{ client_uuid: string; captured_at: string; timezone: string }> = {},
  includeAudio = true,
): FormData {
  const form = new FormData();
  if (includeAudio) {
    form.append(
      "audio",
      new Blob([Buffer.from("fake-audio-bytes")], { type: "audio/m4a" }),
      "capture.m4a",
    );
  }
  form.append("client_uuid", overrides.client_uuid ?? "11111111-1111-4111-8111-111111111111");
  form.append("captured_at", overrides.captured_at ?? "2026-08-16T15:00:00-05:00");
  form.append("timezone", overrides.timezone ?? "America/Chicago");
  return form;
}

describe("POST /transcribe", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
    // POST /transcribe writes real files to AUDIO_STORAGE_PATH (isolated
    // to a dedicated test directory by vitest.config.ts) -- clean the
    // whole thing up rather than leaving test-uploaded audio on disk.
    await rm(env.AUDIO_STORAGE_PATH, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  it("writes an inbox_items row with raw_text null, source ptt, audio_path set, status pending", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/transcribe",
      payload: buildTranscribeForm(),
    });
    expect(response.statusCode).toBe(202);
    const body = response.json<CaptureResponse>();

    const [row] = await app.db.select().from(inboxItems).where(eq(inboxItems.id, body.inbox_id));
    expect(row?.rawText).toBeNull();
    expect(row?.source).toBe("ptt");
    expect(row?.audioPath).not.toBeNull();
    expect(row?.status).toBe("pending");
  });

  it("rejects a request with no audio file", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/transcribe",
      payload: buildTranscribeForm({}, false),
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an invalid IANA timezone", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/transcribe",
      payload: buildTranscribeForm({ timezone: "Not/AZone" }),
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a malformed client_uuid", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/transcribe",
      payload: buildTranscribeForm({ client_uuid: "not-a-uuid" }),
    });
    expect(response.statusCode).toBe(400);
  });

  it("dedupes on client_uuid: a retried request returns the same inbox_id and creates no second row", async () => {
    const clientUuid = "22222222-2222-4222-8222-222222222222";
    const first = await app.inject({
      method: "POST",
      url: "/transcribe",
      payload: buildTranscribeForm({ client_uuid: clientUuid }),
    });
    const second = await app.inject({
      method: "POST",
      url: "/transcribe",
      payload: buildTranscribeForm({ client_uuid: clientUuid }),
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(first.json<CaptureResponse>().inbox_id).toBe(second.json<CaptureResponse>().inbox_id);

    const rows = await app.db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.clientUuid, clientUuid));
    expect(rows).toHaveLength(1);
  });

  it("source is always ptt regardless of any other field supplied", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/transcribe",
      payload: buildTranscribeForm({ client_uuid: "33333333-3333-4333-8333-333333333333" }),
    });
    const body = response.json<CaptureResponse>();
    const [row] = await app.db.select().from(inboxItems).where(eq(inboxItems.id, body.inbox_id));
    expect(row?.source).toBe("ptt");
  });
});
