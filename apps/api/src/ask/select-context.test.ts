import {
  aiModels,
  aiProviderConnections,
  aiTaskRoutes,
  notes,
  projects,
  tasks,
} from "@personal-os/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { AskUnauthorizedError, authorizeCloudAsk, type CloudAskGrant } from "./authorize.js";
import { selectAskContext } from "./select-context.js";

const TZ = "America/Chicago";

function fakeRequest(id = "req-1"): FastifyRequest {
  return { id } as unknown as FastifyRequest;
}

describe("selectAskContext (Checkpoint 8.6B design §7)", () => {
  let app: FastifyInstance;
  let grant: CloudAskGrant;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
    // selectAskContext itself never consults the switch (authorize.ts already
    // did, before this is called) -- an "ask" route is seeded here only so a
    // REAL grant can be minted via the real authorization path. A hand-built
    // object would correctly be refused by assertGrant, which is the whole
    // point: membership is by identity, not shape.
    const [connection] = await app.db
      .insert(aiProviderConnections)
      .values({
        name: "Test provider",
        providerType: "openai_compatible",
        baseUrl: "https://example.invalid/v1",
        apiKeyCiphertext: Buffer.from("ciphertext"),
        apiKeyIv: Buffer.from("iv"),
        apiKeyAuthTag: Buffer.from("authtag"),
      })
      .returning();
    const [model] = await app.db
      .insert(aiModels)
      .values({ providerConnectionId: connection!.id, modelId: "test-model" })
      .returning();
    await app.db.insert(aiTaskRoutes).values({ taskName: "ask", primaryModelId: model!.id });
    const minted = await authorizeCloudAsk(fakeRequest(), app.db);
    if (!minted) throw new Error("test setup: expected a grant");
    grant = minted;
  });

  it("rejects a forged grant before reading anything", async () => {
    const forged = { requestId: "x", grantedAt: "y" };
    await expect(selectAskContext(app.db, forged, ["rent"])).rejects.toThrow(AskUnauthorizedError);
  });

  it("matches a task title and a note body via the same term", async () => {
    await app.db.insert(tasks).values({ title: "Renew the insurance", timezone: TZ });
    await app.db.insert(notes).values({ title: "unrelated", body: "insurance quote from Acme" });

    const results = await selectAskContext(app.db, grant, ["insurance"]);
    expect(results.map((r) => r.type).sort()).toEqual(["note", "task"]);
  });

  it("excludes archived tasks and notes", async () => {
    await app.db
      .insert(tasks)
      .values({ title: "archived rent task", timezone: TZ, archivedAt: new Date() });
    await app.db
      .insert(notes)
      .values({ title: "archived rent note", body: "x", archivedAt: new Date() });

    const results = await selectAskContext(app.db, grant, ["rent"]);
    expect(results).toEqual([]);
  });

  it("excludes done and dropped tasks -- Ask answers about live work", async () => {
    await app.db.insert(tasks).values({ title: "rent done task", timezone: TZ, status: "done" });
    await app.db
      .insert(tasks)
      .values({ title: "rent dropped task", timezone: TZ, status: "dropped" });
    await app.db
      .insert(tasks)
      .values({ title: "rent active task", timezone: TZ, status: "active" });

    const results = await selectAskContext(app.db, grant, ["rent"]);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("rent active task");
  });

  it("attaches the project name via a join, and null when there is none", async () => {
    const [project] = await app.db.insert(projects).values({ name: "Household" }).returning();
    await app.db
      .insert(tasks)
      .values({ title: "rent task with project", timezone: TZ, projectId: project!.id });
    await app.db.insert(tasks).values({ title: "rent task without project", timezone: TZ });

    const results = await selectAskContext(app.db, grant, ["rent"]);
    const withProject = results.find((r) => r.title.includes("with project"));
    const withoutProject = results.find((r) => r.title.includes("without project"));
    expect(withProject?.projectName).toBe("Household");
    expect(withoutProject?.projectName).toBeNull();
  });

  it("ranks by number of distinct terms matched, most first", async () => {
    await app.db.insert(notes).values({ title: "rent renewal insurance", body: "x" });
    await app.db.insert(notes).values({ title: "rent only", body: "x" });

    const results = await selectAskContext(app.db, grant, ["rent", "renewal", "insurance"]);
    expect(results[0]!.title).toBe("rent renewal insurance");
    expect(results[0]!.matchCount).toBe(3);
    expect(results[1]!.matchCount).toBe(1);
  });

  it("caps at 5 per type and 8 total, preferring the higher-ranked rows", async () => {
    for (let i = 0; i < 7; i += 1) {
      await app.db.insert(tasks).values({
        title: `rent task ${i}`,
        timezone: TZ,
        updatedAt: new Date(Date.UTC(2026, 7, i + 1)),
      });
    }
    for (let i = 0; i < 7; i += 1) {
      await app.db.insert(notes).values({
        title: `rent note ${i}`,
        body: "x",
        updatedAt: new Date(Date.UTC(2026, 7, i + 1)),
      });
    }

    const results = await selectAskContext(app.db, grant, ["rent"]);
    expect(results).toHaveLength(8);
    expect(results.filter((r) => r.type === "task")).toHaveLength(4);
    expect(results.filter((r) => r.type === "note")).toHaveLength(4);
    // Most recent rows survive the cap (both types tied on matchCount, so
    // recency breaks the tie -- rows 6 and 5, the newest, must be present).
    expect(results.some((r) => r.title === "rent task 6")).toBe(true);
    expect(results.some((r) => r.title === "rent note 6")).toBe(true);
  });

  it("a term containing LIKE metacharacters is treated as literal text, not a wildcard", async () => {
    await app.db.insert(tasks).values({ title: "50% off widget", timezone: TZ });
    await app.db.insert(tasks).values({ title: "totally unrelated", timezone: TZ });

    // Bypassing extractAskTerms's own stopword/length filtering to prove THIS
    // layer's own escaping holds independently -- the same defence-in-depth
    // discipline ADR-059 already established for /search.
    const results = await selectAskContext(app.db, grant, ["50%"]);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("50% off widget");
  });

  it("returns an empty array when nothing matches", async () => {
    await app.db.insert(tasks).values({ title: "nothing relevant", timezone: TZ });
    expect(await selectAskContext(app.db, grant, ["zzzznomatch"])).toEqual([]);
  });
});
