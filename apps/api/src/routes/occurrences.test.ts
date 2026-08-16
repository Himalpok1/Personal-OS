import { occurrences, tasks } from "@personal-os/db";
import type { Occurrence } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { Paginated } from "../test/types.js";

describe("GET /occurrences (list)", () => {
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

  it("lists occurrences scoped to a parent, filterable by status", async () => {
    const [task] = await app.db
      .insert(tasks)
      .values({ title: "Recurring", status: "active", timezone: "America/Chicago" })
      .returning();

    await app.db.insert(occurrences).values([
      {
        parentType: "task",
        parentId: task!.id,
        occursAt: new Date("2026-08-10T00:00:00Z"),
        occursLocal: new Date("2026-08-10T00:00:00Z"),
        status: "scheduled",
      },
      {
        parentType: "task",
        parentId: task!.id,
        occursAt: new Date("2026-08-17T00:00:00Z"),
        occursLocal: new Date("2026-08-17T00:00:00Z"),
        status: "done",
      },
    ]);

    const all = await app.inject({
      method: "GET",
      url: `/occurrences?parent_type=task&parent_id=${task!.id}`,
    });
    expect(all.json<Paginated<Occurrence>>().total).toBe(2);

    const scheduledOnly = await app.inject({
      method: "GET",
      url: `/occurrences?parent_type=task&parent_id=${task!.id}&status=scheduled`,
    });
    const scheduledBody = scheduledOnly.json<Paginated<Occurrence>>();
    expect(scheduledBody.total).toBe(1);
    expect(scheduledBody.items[0]!.status).toBe("scheduled");
  });

  it("requires parent_type and parent_id", async () => {
    const response = await app.inject({ method: "GET", url: "/occurrences" });
    expect(response.statusCode).toBe(400);
  });
});
