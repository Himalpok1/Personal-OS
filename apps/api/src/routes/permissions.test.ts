import { permissionGrants } from "@personal-os/db";
import {
  ACTION_PERMISSION_DISCLOSURE_VERSION,
  PermissionUpdateResponseSchema,
  PermissionsResponseSchema,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentHeaders, pairTestDevice } from "../test/agents.test-support.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

// Checkpoint 10.8 (ADR-078 §3) -- the owner-facing permission layer. Since
// Checkpoint 10.9 (ADR-082) the PATCH is DEVICE-bound, so `patch` carries a
// paired device's bearer; the assertions are the 10.8 ones, unchanged.

let deviceToken = "";

async function list(app: FastifyInstance) {
  const response = await app.inject({ method: "GET", url: "/permissions" });
  expect(response.statusCode).toBe(200);
  return PermissionsResponseSchema.parse(response.json());
}

async function patch(app: FastifyInstance, permission: string, granted: boolean) {
  const response = await app.inject({
    method: "PATCH",
    url: `/permissions/${permission}`,
    headers: agentHeaders(deviceToken),
    payload: { granted },
  });
  return response;
}

describe("permissions routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
    deviceToken = await pairTestDevice(app);
  });

  it("ships every permission granted to the app by default, with no row written (ADR-078 §3)", async () => {
    const body = await list(app);
    expect(body.disclosure_version).toBe(ACTION_PERMISSION_DISCLOSURE_VERSION);
    expect(body.items.map((item) => item.permission)).toEqual(["tasks.write", "calendar.write"]);
    for (const item of body.items) {
      expect(item.principal).toBe("app");
      expect(item.granted).toBe(true);
      expect(item.granted_at).toBeNull();
      expect(item.needs_reconsent).toBe(false);
      expect(item.usage_count).toBe(0);
      expect(item.action_ids.length).toBeGreaterThan(0);
      expect(item.label.length).toBeGreaterThan(0);
    }
    expect(await app.db.select().from(permissionGrants)).toHaveLength(0);
  });

  it("revoke materialises a revoked row; re-grant inserts a new live row; the history survives", async () => {
    const revoked = await patch(app, "calendar.write", false);
    expect(revoked.statusCode).toBe(200);
    const revokedBody = PermissionUpdateResponseSchema.parse(revoked.json());
    expect(revokedBody.item.granted).toBe(false);
    expect(revokedBody.item.revoked_at).not.toBeNull();
    expect(revokedBody.cancelled_pending).toBe(0);

    const afterRevoke = await list(app);
    expect(afterRevoke.items.find((i) => i.permission === "calendar.write")?.granted).toBe(false);
    expect(afterRevoke.items.find((i) => i.permission === "tasks.write")?.granted).toBe(true);

    const granted = await patch(app, "calendar.write", true);
    const grantedBody = PermissionUpdateResponseSchema.parse(granted.json());
    expect(grantedBody.item.granted).toBe(true);
    expect(grantedBody.item.revoked_at).toBeNull();
    expect(grantedBody.item.disclosure_version).toBe(ACTION_PERMISSION_DISCLOSURE_VERSION);

    const rows = await app.db.select().from(permissionGrants);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
  });

  it("granting an already-live permission and revoking an already-revoked one are no-ops", async () => {
    await patch(app, "tasks.write", true);
    await patch(app, "tasks.write", true);
    expect(await app.db.select().from(permissionGrants)).toHaveLength(0);
    await patch(app, "tasks.write", false);
    await patch(app, "tasks.write", false);
    expect(await app.db.select().from(permissionGrants)).toHaveLength(1);
  });

  it("reports needs_reconsent when the live grant predates the current disclosure", async () => {
    await app.db.insert(permissionGrants).values({
      principal: "app",
      permission: "tasks.write",
      disclosureVersion: "2000-01-01",
    });
    const body = await list(app);
    const item = body.items.find((i) => i.permission === "tasks.write")!;
    expect(item.granted).toBe(true);
    expect(item.needs_reconsent).toBe(true);
  });

  it("refuses an unknown permission (400 -- the vocabulary is closed) and a non-boolean body", async () => {
    const unknown = await patch(app, "health.write", false);
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json<ErrorBody>().error).toBe("validation_failed");
    const bad = await app.inject({
      method: "PATCH",
      url: "/permissions/tasks.write",
      headers: agentHeaders(deviceToken),
      payload: { granted: "no" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("never lets the app PATCH name a principal -- the agent principal has its own device-bound path", async () => {
    const body = await list(app);
    expect(body.items.every((item) => item.principal === "app")).toBe(true);
    const forged = await app.inject({
      method: "PATCH",
      url: "/permissions/tasks.write",
      headers: agentHeaders(deviceToken),
      payload: { granted: true, principal: "agent" },
    });
    expect(forged.statusCode).toBe(400);
  });

  it("refuses the PATCH without a device token (401 unauthorized) and writes nothing (ADR-082)", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/permissions/tasks.write",
      payload: { granted: false },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error).toBe("unauthorized");
    expect(await app.db.select().from(permissionGrants)).toHaveLength(0);
    expect((await list(app)).items.every((item) => item.granted)).toBe(true);
  });
});
