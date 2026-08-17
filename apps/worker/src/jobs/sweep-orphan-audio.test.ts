import { mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { inboxItems, type Db } from "@personal-os/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../env.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { sweepOrphanAudioJob } from "./sweep-orphan-audio.js";

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

async function setAge(filePath: string, ageMs: number): Promise<void> {
  const past = new Date(Date.now() - ageMs);
  await utimes(filePath, past, past);
}

describe("sweepOrphanAudioJob", () => {
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

  it("deletes an old, unreferenced file", async () => {
    const filePath = path.join(testAudioDir, "old-orphan.m4a");
    await writeFile(filePath, "x");
    await setAge(filePath, 3 * 60 * 60 * 1000); // 3h old

    await sweepOrphanAudioJob(db);

    expect(await exists(filePath)).toBe(false);
  });

  it("leaves a fresh, unreferenced file alone (still within the retry window)", async () => {
    const filePath = path.join(testAudioDir, "fresh-orphan.m4a");
    await writeFile(filePath, "x");
    await setAge(filePath, 5 * 60 * 1000); // 5min old

    await sweepOrphanAudioJob(db);

    expect(await exists(filePath)).toBe(true);
  });

  it("leaves an old but still-referenced file alone", async () => {
    const filePath = path.join(testAudioDir, "referenced.m4a");
    await writeFile(filePath, "x");
    await setAge(filePath, 3 * 60 * 60 * 1000); // 3h old
    await db.insert(inboxItems).values({
      rawText: null,
      source: "ptt",
      audioPath: filePath,
      capturedAt: new Date(),
      timezone: "America/Chicago",
      status: "pending",
    });

    await sweepOrphanAudioJob(db);

    expect(await exists(filePath)).toBe(true);
  });

  it("does not throw if the audio directory doesn't exist yet", async () => {
    await rm(testAudioDir, { recursive: true, force: true });
    await expect(sweepOrphanAudioJob(db)).resolves.toBeUndefined();
  });
});
