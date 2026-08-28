import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type * as AiProviders from "@personal-os/ai-providers";
import { inboxItems, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";

vi.mock("@personal-os/ai-providers", async () => {
  const actual = await vi.importActual<typeof AiProviders>("@personal-os/ai-providers");
  return {
    ...actual,
    resolveTranscriptionConnectionForTask: vi.fn(),
    transcribeAudio: vi.fn(),
  };
});

const { resolveTranscriptionConnectionForTask, transcribeAudio } =
  await import("@personal-os/ai-providers");
const {
  createPttTranscribeDeadLetterHandler,
  createPttTranscribeHandler,
  VOICE_TRANSCRIBE_TASK_NAME,
} = await import("./ptt-transcribe.js");
const { AiJobError } = await import("./ai-job-error.js");

function fakeJob(inboxId: string): Job<{ inboxId: string }> {
  return { id: "job-1", name: "ptt.transcribe", data: { inboxId } } as Job<{ inboxId: string }>;
}

// A plain object with a vi.fn() property, not typed as PgBoss until the
// call site -- referencing `bossSend` directly in assertions (rather than
// `boss.send`) avoids a spurious @typescript-eslint/unbound-method warning
// that fires on method-shaped property access against a PgBoss-typed value.
function fakeBoss(): { boss: PgBoss; bossSend: ReturnType<typeof vi.fn> } {
  const bossSend = vi.fn();
  return { boss: { send: bossSend } as unknown as PgBoss, bossSend };
}

async function insertPttInboxItem(db: Db, audioPath: string | null): Promise<string> {
  const [row] = await db
    .insert(inboxItems)
    .values({
      rawText: null,
      source: "ptt",
      audioPath,
      capturedAt: new Date(),
      timezone: "America/Chicago",
      status: "pending",
    })
    .returning({ id: inboxItems.id });
  return row!.id;
}

describe("ptt.transcribe", () => {
  let db: Db;
  const testAudioDir = env.AUDIO_STORAGE_PATH;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    vi.clearAllMocks();
    await mkdir(testAudioDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testAudioDir, { recursive: true, force: true });
  });

  it("is a no-op (idempotent) when audio_path is already null", async () => {
    const inboxId = await insertPttInboxItem(db, null);
    const { boss, bossSend } = fakeBoss();

    await createPttTranscribeHandler(db, boss)([fakeJob(inboxId)]);

    expect(resolveTranscriptionConnectionForTask).not.toHaveBeenCalled();
    expect(bossSend).not.toHaveBeenCalled();
  });

  it("finalizes as failed, clears audio_path, and deletes the file when no provider is configured", async () => {
    const audioPath = path.join(testAudioDir, "no-provider.m4a");
    await writeFile(audioPath, "fake-audio");
    const inboxId = await insertPttInboxItem(db, audioPath);
    const { boss, bossSend } = fakeBoss();

    // No ai_task_routes row for voice_transcribe -- resolveTranscriptionConnectionForTask
    // throws NoProviderConfiguredError for real (not mocked for this case),
    // matching capture-parse.ts's existing convention for the identical error type.
    const actual = await vi.importActual<typeof AiProviders>("@personal-os/ai-providers");
    vi.mocked(resolveTranscriptionConnectionForTask).mockImplementation(
      actual.resolveTranscriptionConnectionForTask,
    );

    await createPttTranscribeHandler(db, boss)([fakeJob(inboxId)]);

    const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxId));
    expect(row?.status).toBe("failed");
    expect(row?.audioPath).toBeNull();
    expect(bossSend).not.toHaveBeenCalled();
    await expect(readFile(audioPath)).rejects.toThrow();
  });

  it("on success: commits the transcript, deletes the audio, and enqueues capture.parse", async () => {
    const audioPath = path.join(testAudioDir, "success.m4a");
    await writeFile(audioPath, "fake-audio");
    const inboxId = await insertPttInboxItem(db, audioPath);
    const { boss, bossSend } = fakeBoss();

    vi.mocked(resolveTranscriptionConnectionForTask).mockResolvedValue({
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: "sk-fake",
      modelId: "whisper-large-v3-turbo",
    });
    vi.mocked(transcribeAudio).mockResolvedValue({
      text: "call the insurance guy tomorrow",
      avgLogprob: -0.1,
      raw: {},
    });

    await createPttTranscribeHandler(db, boss)([fakeJob(inboxId)]);

    const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxId));
    expect(row?.rawText).toBe("call the insurance guy tomorrow");
    expect(row?.confidence).toBe(-0.1);
    expect(row?.audioPath).toBeNull();
    await expect(readFile(audioPath)).rejects.toThrow();
    expect(bossSend).toHaveBeenCalledWith("capture.parse", { inboxId }, { singletonKey: inboxId });
  });

  it("rethrows on a transient transcription failure, leaving the row untouched for retry", async () => {
    const audioPath = path.join(testAudioDir, "transient.m4a");
    await writeFile(audioPath, "fake-audio");
    const inboxId = await insertPttInboxItem(db, audioPath);
    const { boss, bossSend } = fakeBoss();

    vi.mocked(resolveTranscriptionConnectionForTask).mockResolvedValue({
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: "sk-fake",
      modelId: "whisper-large-v3-turbo",
    });
    vi.mocked(transcribeAudio).mockRejectedValue(new Error("transcription request failed: 503"));

    // Still fails the job so pg-boss retries -- but as the contained
    // AiJobError, never the raw STT error whose message embeds the vendor's
    // response body (6.7A, S1).
    const caught: unknown = await createPttTranscribeHandler(
      db,
      boss,
    )([fakeJob(inboxId)]).then(
      () => null,
      (err: unknown) => err,
    );
    expect(caught).toBeInstanceOf(AiJobError);
    expect(String((caught as Error).message)).not.toContain("503");

    const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxId));
    expect(row?.rawText).toBeNull();
    expect(row?.audioPath).toBe(audioPath); // audio still on disk for the retry to use
    expect(bossSend).not.toHaveBeenCalled();
    await expect(readFile(audioPath)).resolves.toBeDefined();
  });

  it("VOICE_TRANSCRIBE_TASK_NAME is the exact task_name resolveTranscriptionConnectionForTask is called with", async () => {
    const audioPath = path.join(testAudioDir, "task-name.m4a");
    await writeFile(audioPath, "fake-audio");
    const inboxId = await insertPttInboxItem(db, audioPath);
    const { boss } = fakeBoss();

    vi.mocked(resolveTranscriptionConnectionForTask).mockResolvedValue({
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: "sk-fake",
      modelId: "whisper-large-v3-turbo",
    });
    vi.mocked(transcribeAudio).mockResolvedValue({ text: "x", avgLogprob: null, raw: {} });

    await createPttTranscribeHandler(db, boss)([fakeJob(inboxId)]);

    expect(resolveTranscriptionConnectionForTask).toHaveBeenCalledWith(
      db,
      VOICE_TRANSCRIBE_TASK_NAME,
      expect.any(String),
    );
  });
});

describe("ptt.transcribe dead-letter handler", () => {
  let db: Db;
  const testAudioDir = env.AUDIO_STORAGE_PATH;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    await mkdir(testAudioDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testAudioDir, { recursive: true, force: true });
  });

  it("finalizes a still-open row as failed and deletes its audio", async () => {
    const audioPath = path.join(testAudioDir, "dead-letter.m4a");
    await writeFile(audioPath, "fake-audio");
    const inboxId = await insertPttInboxItem(db, audioPath);

    await createPttTranscribeDeadLetterHandler(db)([fakeJob(inboxId)]);

    const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxId));
    expect(row?.status).toBe("failed");
    expect(row?.audioPath).toBeNull();
    await expect(readFile(audioPath)).rejects.toThrow();
  });

  it("is a no-op for a row already resolved (audio_path already null)", async () => {
    const inboxId = await insertPttInboxItem(db, null);
    await db.update(inboxItems).set({ status: "parsed" }).where(eq(inboxItems.id, inboxId));

    await createPttTranscribeDeadLetterHandler(db)([fakeJob(inboxId)]);

    const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxId));
    expect(row?.status).toBe("parsed"); // untouched, not overwritten to "failed"
  });
});
