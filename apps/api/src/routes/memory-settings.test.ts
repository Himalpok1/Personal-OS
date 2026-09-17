import { memories, memorySettings, memorySuggestions } from "@personal-os/db";
import { MemorySettingsSchema, type MemorySettings } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

// Checkpoint 10.7 (ADR-077 §7) -- the global memory switch.

describe("memory settings routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
    await app.db.delete(memories);
    await app.db.delete(memorySuggestions);
    await app.db.delete(memorySettings);
  });

  async function getSettings(): Promise<MemorySettings> {
    const response = await app.inject({ method: "GET", url: "/memory-settings" });
    expect(response.statusCode).toBe(200);
    return MemorySettingsSchema.parse(response.json());
  }

  it("answers enabled=true with no row at all -- the layer ships ON", async () => {
    expect(await app.db.select().from(memorySettings)).toHaveLength(0);
    expect(await getSettings()).toEqual({ enabled: true, memory_count: 0 });
    // GET materialises nothing.
    expect(await app.db.select().from(memorySettings)).toHaveLength(0);
  });

  it("counts every memory regardless of the switch", async () => {
    await app.db.insert(memories).values([
      { kind: "fact", statement: "a", source: "user" },
      { kind: "goal", statement: "b", source: "user" },
    ]);
    expect((await getSettings()).memory_count).toBe(2);
    await app.inject({ method: "PATCH", url: "/memory-settings", payload: { enabled: false } });
    expect(await getSettings()).toEqual({ enabled: false, memory_count: 2 });
  });

  it("PATCH upserts the singleton both ways and echoes the new state", async () => {
    const off = await app.inject({
      method: "PATCH",
      url: "/memory-settings",
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);
    expect(MemorySettingsSchema.parse(off.json())).toEqual({ enabled: false, memory_count: 0 });
    const rows = await app.db.select().from(memorySettings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "singleton", enabled: false });

    const on = await app.inject({
      method: "PATCH",
      url: "/memory-settings",
      payload: { enabled: true },
    });
    expect(MemorySettingsSchema.parse(on.json())).toEqual({ enabled: true, memory_count: 0 });
    const after = await app.db.select().from(memorySettings);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: "singleton", enabled: true });
    expect(after[0]!.updatedAt.getTime()).toBeGreaterThanOrEqual(rows[0]!.updatedAt.getTime());
    expect(await getSettings()).toEqual({ enabled: true, memory_count: 0 });
  });

  it("rejects a malformed body", async () => {
    for (const payload of [{}, { enabled: "false" }, { enabled: false, extra: 1 }]) {
      const response = await app.inject({ method: "PATCH", url: "/memory-settings", payload });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    }
  });

  it("turning the switch off never hides or blocks the owner's own data", async () => {
    await app.inject({ method: "PATCH", url: "/memory-settings", payload: { enabled: false } });
    const created = await app.inject({
      method: "POST",
      url: "/memories",
      payload: { kind: "fact", statement: "still mine" },
    });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/memories" });
    expect(list.json<{ total: number }>().total).toBe(1);
    const exported = await app.inject({ method: "GET", url: "/export" });
    expect(exported.body).toContain("still mine");
  });
});
