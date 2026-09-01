import { NoProviderConfiguredError } from "@personal-os/ai-providers";
import { aiModels, aiProviderConnections, mailDigests, type Db } from "@personal-os/db";
import { MailDigestRecordSchema } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../../test/build-test-db.js";
import { seedMailConnection, seedMailMessage } from "../../test/mail-fixtures.js";
import {
  MailDigestFailedError,
  MailDigestTimeoutError,
  type MailDigestInput,
} from "./contracts.js";
import type { GeneratedMailDigest } from "./generate.js";
import { persistMailDigest, readMailDigest, runMailDigest } from "./run.js";

const db: Db = buildTestDb();
const NOW = new Date("2026-09-01T12:00:00.000Z");
const TZ = "America/Chicago";
const LOCAL_DATE = "2026-09-01";

/** A stub generator. The real one is exercised by generate's own callers. */
function stubGenerator(result: GeneratedMailDigest | Error) {
  const calls: MailDigestInput[] = [];
  const fn = (_db: Db, input: MailDigestInput): Promise<GeneratedMailDigest> => {
    calls.push(input);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return { fn, calls };
}

function generated(text: string, modelRowId: string | null = null): GeneratedMailDigest {
  return { content: { text }, modelRowId, linksRemoved: 0 };
}

/**
 * Seeds a real `ai_models` row.
 *
 * A fabricated uuid is not usable here: `mail_digests.model_id` carries a
 * foreign key to `ai_models`, so an invented id is rejected outright -- which
 * this test suite discovered by trying. Seeding a real row proves rather more
 * than the shortcut would have: that the FK is satisfiable and that the id
 * genuinely reaches the column.
 */
async function seedModel(): Promise<string> {
  const [connection] = await db
    .insert(aiProviderConnections)
    .values({
      name: "Test Provider",
      providerType: "openai_compatible",
      apiKeyCiphertext: Buffer.from("ciphertext"),
      apiKeyIv: Buffer.from("iv"),
      apiKeyAuthTag: Buffer.from("tag"),
    })
    .returning({ id: aiProviderConnections.id });
  const [model] = await db
    .insert(aiModels)
    .values({ providerConnectionId: connection!.id, modelId: "test-model" })
    .returning({ id: aiModels.id });
  return model!.id;
}

async function seedOneMessage(): Promise<void> {
  const connection = await seedMailConnection(db);
  await seedMailMessage(db, connection.id, {
    subject: "Quarterly report",
    fromDisplayName: "Ada Lovelace",
    internalDate: new Date(NOW.getTime() - 60 * 60 * 1000),
  });
}

beforeEach(async () => {
  await truncateTestTables(db);
});

afterAll(async () => {
  await truncateTestTables(db);
  await db.$client.end();
});

describe("persistMailDigest", () => {
  it("writes a row readable back through the frozen record schema", async () => {
    await persistMailDigest(db, {
      digestDate: LOCAL_DATE,
      timezone: TZ,
      text: "You have 3 new messages.",
      modelRowId: null,
      now: NOW,
    });

    const row = await readMailDigest(db, LOCAL_DATE, TZ);
    expect(row).toBeDefined();
    const parsed = MailDigestRecordSchema.parse({
      id: row!.id,
      digest_date: row!.digestDate,
      timezone: row!.timezone,
      content: row!.content,
      model_id: row!.modelId,
      generated_at: row!.generatedAt.toISOString(),
    });
    expect(parsed.content.text).toBe("You have 3 new messages.");
  });

  it("upserts on (digest_date, timezone) rather than appending history", async () => {
    // ADR-054 keeps exactly one digest per key with no history, mirroring
    // ai_daily_briefs.
    const first = await persistMailDigest(db, {
      digestDate: LOCAL_DATE,
      timezone: TZ,
      text: "first",
      modelRowId: null,
      now: NOW,
    });
    const second = await persistMailDigest(db, {
      digestDate: LOCAL_DATE,
      timezone: TZ,
      text: "second",
      modelRowId: null,
      now: new Date(NOW.getTime() + 60_000),
    });

    expect(second).toBe(first);
    const rows = await db.select().from(mailDigests);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.content as { text: string }).text).toBe("second");
  });

  it("treats the same date in a DIFFERENT timezone as a different digest", async () => {
    // The reason timezone is part of the key: the same instant is a different
    // local calendar date in different zones, and the row describes one
    // requested local day.
    await persistMailDigest(db, {
      digestDate: LOCAL_DATE,
      timezone: TZ,
      text: "chicago",
      modelRowId: null,
      now: NOW,
    });
    await persistMailDigest(db, {
      digestDate: LOCAL_DATE,
      timezone: "Pacific/Auckland",
      text: "auckland",
      modelRowId: null,
      now: NOW,
    });

    expect(await db.select().from(mailDigests)).toHaveLength(2);
  });

  it("keeps created_at while advancing generated_at on regeneration", async () => {
    const id = await persistMailDigest(db, {
      digestDate: LOCAL_DATE,
      timezone: TZ,
      text: "first",
      modelRowId: null,
      now: NOW,
    });
    const [before] = await db.select().from(mailDigests).where(eq(mailDigests.id, id));

    const later = new Date(NOW.getTime() + 3_600_000);
    await persistMailDigest(db, {
      digestDate: LOCAL_DATE,
      timezone: TZ,
      text: "second",
      modelRowId: null,
      now: later,
    });
    const [after] = await db.select().from(mailDigests).where(eq(mailDigests.id, id));

    // created_at is the row's identity; generated_at is when the CONTENT was
    // produced. The table separates them deliberately.
    expect(after!.createdAt.toISOString()).toBe(before!.createdAt.toISOString());
    expect(after!.generatedAt.toISOString()).toBe(later.toISOString());
  });
});

describe("runMailDigest: the no-overwrite guarantee", () => {
  it("a FAILED generation leaves an existing digest completely untouched", async () => {
    // ===================================================================
    // THE INVARIANT MIGRATION 0014 DEMANDED OF THIS CHECKPOINT BY NAME.
    // ===================================================================
    // It is structural, not conventional: the persist call sits after the
    // generate call in one straight line, so there is no catch branch that can
    // write and no partial value to write.
    await seedOneMessage();
    await persistMailDigest(db, {
      digestDate: LOCAL_DATE,
      timezone: TZ,
      text: "yesterday's good digest",
      modelRowId: null,
      now: NOW,
    });
    const before = await readMailDigest(db, LOCAL_DATE, TZ);

    const failing = stubGenerator(new MailDigestFailedError());
    const result = await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: failing.fn,
    });

    expect(result.failureClass).toBe("digest_failed");
    expect(result.digestDate).toBeNull();

    const after = await readMailDigest(db, LOCAL_DATE, TZ);
    expect(after!.content).toEqual(before!.content);
    expect(after!.generatedAt.toISOString()).toBe(before!.generatedAt.toISOString());
    expect(after!.updatedAt.toISOString()).toBe(before!.updatedAt.toISOString());
  });

  it("a TIMED OUT generation likewise writes nothing", async () => {
    await seedOneMessage();
    await persistMailDigest(db, {
      digestDate: LOCAL_DATE,
      timezone: TZ,
      text: "keep me",
      modelRowId: null,
      now: NOW,
    });

    const result = await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stubGenerator(new MailDigestTimeoutError()).fn,
    });

    expect(result.failureClass).toBe("digest_timeout");
    const row = await readMailDigest(db, LOCAL_DATE, TZ);
    expect((row!.content as { text: string }).text).toBe("keep me");
  });

  it("an UNEXPECTED error writes nothing and does not escape", async () => {
    // Returning rather than throwing, for the reason every mail job does: the
    // queue is retryLimit 0, so throwing makes pg-boss neither the retry nor a
    // useful record. The next tick is the retry.
    await seedOneMessage();
    await persistMailDigest(db, {
      digestDate: LOCAL_DATE,
      timezone: TZ,
      text: "keep me too",
      modelRowId: null,
      now: NOW,
    });

    const result = await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stubGenerator(new Error("provider exploded")).fn,
    });

    expect(result.failureClass).toBe("digest_error");
    const row = await readMailDigest(db, LOCAL_DATE, TZ);
    expect((row!.content as { text: string }).text).toBe("keep me too");
  });

  it("writes NO row at all when generation fails and none existed", async () => {
    await seedOneMessage();
    const result = await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stubGenerator(new MailDigestFailedError()).fn,
    });
    expect(result.failureClass).toBe("digest_failed");
    expect(await db.select().from(mailDigests)).toHaveLength(0);
  });
});

describe("runMailDigest: model provenance", () => {
  it("records the model that ACTUALLY served the call", async () => {
    // Straight from callWithFallbackTracked, never re-derived from the route's
    // primary, so a fallback hit is never misrecorded as the primary's.
    await seedOneMessage();
    const modelRowId = await seedModel();

    const result = await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stubGenerator(generated("A digest.", modelRowId)).fn,
    });

    expect(result.modelRowId).toBe(modelRowId);
    const row = await readMailDigest(db, LOCAL_DATE, TZ);
    expect(row!.modelId).toBe(modelRowId);
  });

  it("stores a null model id without losing the digest", async () => {
    // model_id is nullable and ON DELETE SET NULL: a later model deletion must
    // not take the digest's history with it.
    await seedOneMessage();
    await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stubGenerator(generated("A digest.", null)).fn,
    });
    const row = await readMailDigest(db, LOCAL_DATE, TZ);
    expect(row!.modelId).toBeNull();
    expect((row!.content as { text: string }).text).toBe("A digest.");
  });
});

describe("runMailDigest: skips", () => {
  it("skips without a provider call when no mailbox has any mail", async () => {
    // Paying a provider call to be told there is no mail would also write a row
    // saying nothing, displacing a real digest from an earlier pass on the same
    // local date.
    await seedMailConnection(db);
    const stub = stubGenerator(generated("should not be called"));

    const result = await runMailDigest({ db, now: () => NOW, timezone: TZ, generate: stub.fn });

    expect(result.skipped).toBe("no_active_mailboxes");
    expect(stub.calls).toHaveLength(0);
    expect(await db.select().from(mailDigests)).toHaveLength(0);
  });

  it("skips distinctly when no mail_digest route is registered", async () => {
    // A deployment state, not a fault -- recorded separately so it is never
    // mistaken for a provider outage.
    await seedOneMessage();
    const result = await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stubGenerator(new NoProviderConfiguredError("mail_digest")).fn,
    });

    expect(result.skipped).toBe("no_provider_configured");
    expect(result.failureClass).toBeNull();
    expect(await db.select().from(mailDigests)).toHaveLength(0);
  });
});

describe("runMailDigest: the happy path", () => {
  it("collects, generates and persists exactly one digest", async () => {
    await seedOneMessage();
    const stub = stubGenerator(generated("You have one new message from Ada Lovelace."));

    const result = await runMailDigest({ db, now: () => NOW, timezone: TZ, generate: stub.fn });

    expect(result.skipped).toBeNull();
    expect(result.failureClass).toBeNull();
    expect(result.digestDate).toBe(LOCAL_DATE);

    // The generator saw a bounded payload with real counts.
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.summary.total_count).toBe(1);
    expect(stub.calls[0]!.highlights.items[0]!.subject).toBe("Quarterly report");

    const rows = await db.select().from(mailDigests);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.content as { text: string }).text).toBe(
      "You have one new message from Ada Lovelace.",
    );
  });

  it("regenerating replaces the same row rather than adding one", async () => {
    await seedOneMessage();
    await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stubGenerator(generated("first pass")).fn,
    });
    await runMailDigest({
      db,
      now: () => new Date(NOW.getTime() + 3_600_000),
      timezone: TZ,
      generate: stubGenerator(generated("second pass")).fn,
    });

    const rows = await db.select().from(mailDigests);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.content as { text: string }).text).toBe("second pass");
  });

  it("stores ONLY the text, never a field the model invented", async () => {
    // Server-owned output shape. MailDigestContentSchema is .passthrough() for
    // future SERVER-authored fields, not a licence to persist model-returned
    // keys -- so the generator reconstructs { text } rather than spreading.
    await seedOneMessage();
    await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stubGenerator(generated("clean text")).fn,
    });
    const row = await readMailDigest(db, LOCAL_DATE, TZ);
    expect(Object.keys(row!.content as object)).toEqual(["text"]);
  });

  it("derives digest_date from the REQUESTED zone, not from a UTC slice", async () => {
    // 2026-09-01T12:00Z is still 2026-09-01 in Chicago but already 2026-09-02 in
    // Auckland. Slicing the instant would give both the same date and collide
    // two genuinely different local days onto one key.
    await seedOneMessage();
    await runMailDigest({
      db,
      now: () => NOW,
      timezone: "Pacific/Auckland",
      generate: stubGenerator(generated("auckland digest")).fn,
    });
    expect(await readMailDigest(db, "2026-09-02", "Pacific/Auckland")).toBeDefined();
    expect(await readMailDigest(db, LOCAL_DATE, "Pacific/Auckland")).toBeUndefined();
  });
});

describe("runMailDigest: notification is contained (Checkpoint 7.6)", () => {
  it("notifies AFTER persisting, with the digest's own date and zone", async () => {
    await seedOneMessage();
    const stub = stubGenerator(generated("One new message."));
    const seen: { digestDate: string; timezone: string }[] = [];

    const result = await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stub.fn,
      notify: async ({ digestDate, timezone }) => {
        // Read INSIDE the notifier: if this finds the row, the write happened
        // first, which is the ordering the no-overwrite guarantee depends on.
        const row = await readMailDigest(db, LOCAL_DATE, TZ);
        expect(row).not.toBeNull();
        seen.push({ digestDate, timezone });
      },
    });

    expect(result.skipped).toBeNull();
    expect(seen).toEqual([{ digestDate: LOCAL_DATE, timezone: TZ }]);
  });

  it("a FAILING notifier does not undo the digest or fail the pass", async () => {
    // A push problem must never destroy a persisted digest, and must never turn
    // a successful pass into a failed job -- the cron would then retry it and
    // pay another model call to fix a notification.
    await seedOneMessage();
    const stub = stubGenerator(generated("One new message."));

    const result = await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stub.fn,
      notify: () => Promise.reject(new Error("queue exploded")),
    });

    expect(result.skipped).toBeNull();
    expect(result.failureClass).toBeNull();
    const row = await readMailDigest(db, LOCAL_DATE, TZ);
    expect(row?.content).toEqual({ text: "One new message." });
  });

  it("does NOT notify when generation failed", async () => {
    // Nothing was persisted, so there is nothing to announce. Announcing here
    // would tell the user a digest is ready when the previous day's is still
    // the newest thing in the table.
    await seedOneMessage();
    const stub = stubGenerator(new Error("provider down"));
    let notified = false;

    const result = await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stub.fn,
      notify: () => {
        notified = true;
        return Promise.resolve();
      },
    });

    expect(result.failureClass).not.toBeNull();
    expect(notified).toBe(false);
  });

  it("does NOT notify when the pass skipped", async () => {
    // No mailbox, no digest, nothing to say.
    const stub = stubGenerator(generated("unreachable"));
    let notified = false;

    const result = await runMailDigest({
      db,
      now: () => NOW,
      timezone: TZ,
      generate: stub.fn,
      notify: () => {
        notified = true;
        return Promise.resolve();
      },
    });

    expect(result.skipped).toBe("no_active_mailboxes");
    expect(notified).toBe(false);
  });
});
