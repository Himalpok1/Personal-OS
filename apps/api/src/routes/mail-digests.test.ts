import {
  aiModels,
  aiProviderConnections,
  aiTaskRoutes,
  mailConnections,
  mailDigests,
} from "@personal-os/db";
import type { MailDigestCurrentResponse } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

// Route tests for the mail digest surface.
//
// `vitest.config.ts` sets the GMAIL_OAUTH_* trio, so `isMailConfigured()` is
// true throughout this file. The not-configured branch is deliberately NOT
// tested here: a vitest `env` block cannot express an absent variable for one
// file while another needs it present, which is the same reason
// `env-mail-config.test.ts` exists as a separate in-process re-parse.

let app: FastifyInstance;
const GENERATED_AT = new Date("2026-09-01T13:00:00.000Z");

async function seedConnection(status = "active"): Promise<string> {
  const [row] = await app.db
    .insert(mailConnections)
    .values({
      provider: "gmail",
      externalAccountId: `person+${Math.random().toString(36).slice(2)}@example.com`,
      status,
    })
    .returning({ id: mailConnections.id });
  return row!.id;
}

/** A real ai_models row -- mail_digests.model_id is a foreign key. */
async function seedModel(): Promise<string> {
  const [connection] = await app.db
    .insert(aiProviderConnections)
    .values({
      name: `provider-${Math.random().toString(36).slice(2, 8)}`,
      providerType: "openai_compatible",
      baseUrl: "https://example.invalid/v1",
      apiKeyCiphertext: Buffer.from("x"),
      apiKeyIv: Buffer.from("y"),
      apiKeyAuthTag: Buffer.from("z"),
    })
    .returning({ id: aiProviderConnections.id });
  const [model] = await app.db
    .insert(aiModels)
    .values({ providerConnectionId: connection!.id, modelId: "test-model" })
    .returning({ id: aiModels.id });
  return model!.id;
}

async function seedDigestRoute(): Promise<void> {
  const modelId = await seedModel();
  await app.db.insert(aiTaskRoutes).values({ taskName: "mail_digest", primaryModelId: modelId });
}

async function seedDigest(values: Record<string, unknown> = {}): Promise<void> {
  await app.db.insert(mailDigests).values({
    digestDate: "2026-09-01",
    timezone: "UTC",
    content: { text: "Two messages need attention." },
    generatedAt: GENERATED_AT,
    ...values,
  });
}

beforeEach(async () => {
  app ??= await buildTestApp();
  await truncateTestTables(app);
  // `truncateTestTables` deliberately leaves ai_provider_connections/ai_models
  // alone -- briefs.test.ts and today.test.ts both rely on that, and each seeds
  // a fresh model per test so accumulated rows are harmless. `ai_task_routes` is
  // different: `task_name` is UNIQUE, so a leaked `mail_digest` row would both
  // break the next insert AND make a "no route registered" test see one.
  await app.db.delete(aiTaskRoutes).where(eq(aiTaskRoutes.taskName, "mail_digest"));
});

afterAll(async () => {
  await truncateTestTables(app);
  await app.close();
});

describe("GET /mail-digests/current", () => {
  it("distinguishes the three empty states rather than collapsing them", async () => {
    // "No digest yet" means something completely different depending on whether
    // a mailbox is connected. Collapsing them would tell a user to go set up
    // something that is already set up.
    const noMailbox = await app.inject({ method: "GET", url: "/mail-digests/current" });
    expect(noMailbox.statusCode).toBe(200);
    expect(noMailbox.json()).toEqual({
      configured: true,
      has_active_mailbox: false,
      digest: null,
    });

    await seedConnection();
    const connectedNoDigest = await app.inject({ method: "GET", url: "/mail-digests/current" });
    expect(connectedNoDigest.json()).toEqual({
      configured: true,
      has_active_mailbox: true,
      digest: null,
    });
  });

  it("does not count a DISCONNECTED mailbox as active", async () => {
    await seedConnection("disconnected");
    const res = await app.inject({ method: "GET", url: "/mail-digests/current" });
    expect(current(res).has_active_mailbox).toBe(false);
  });

  it("returns the digest with its own date and timezone", async () => {
    // The row says what it covers. That is what lets a screen be honest about a
    // digest generated in a zone the device is not in.
    await seedDigest();
    const res = await app.inject({ method: "GET", url: "/mail-digests/current" });
    expect(current(res).digest).toMatchObject({
      digest_date: "2026-09-01",
      timezone: "UTC",
      content: { text: "Two messages need attention." },
      model_id: null,
    });
  });

  it("takes NO tz parameter, and ignores one if sent", async () => {
    // A digest's zone is the worker's configuration. Accepting a client zone
    // would mean a device in America/Chicago finding nothing against a server
    // configured for UTC -- an empty digest forever while one sat in the table.
    await seedDigest();
    const res = await app.inject({
      method: "GET",
      url: "/mail-digests/current?tz=America/Chicago",
    });
    expect(res.statusCode).toBe(200);
    expect(current(res).digest?.timezone).toBe("UTC");
  });

  it("returns the most recently GENERATED digest, not the latest date", async () => {
    // Regeneration advances generated_at while digest_date stays put, so
    // ordering by date would pin a stale row as "current" after a same-day
    // regeneration.
    await seedDigest({
      digestDate: "2026-09-02",
      content: { text: "stale" },
      generatedAt: new Date("2026-09-01T09:00:00.000Z"),
    });
    await seedDigest({
      digestDate: "2026-09-01",
      content: { text: "fresh" },
      generatedAt: new Date("2026-09-01T18:00:00.000Z"),
    });

    const res = await app.inject({ method: "GET", url: "/mail-digests/current" });
    expect(current(res).digest?.content.text).toBe("fresh");
  });

  it("carries no credential-shaped field", async () => {
    await seedConnection();
    await seedDigest();
    const res = await app.inject({ method: "GET", url: "/mail-digests/current" });
    for (const forbidden of ["token", "ciphertext", "auth_tag", "secret", "@example.com"]) {
      expect(res.body).not.toContain(forbidden);
    }
  });
});

describe("POST /mail-digests", () => {
  it("409s when no mailbox is connected, naming the upstream cause", async () => {
    // Checked FIRST, before the model route: telling someone "no AI provider"
    // when the real problem is that no mailbox is connected sends them to
    // configure the wrong thing.
    const res = await app.inject({ method: "POST", url: "/mail-digests" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_active_mailboxes" });
  });

  it("409s when no mail_digest model route is registered", async () => {
    await seedConnection();
    const res = await app.inject({ method: "POST", url: "/mail-digests" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_provider_configured" });
  });

  it("does not treat a DISCONNECTED mailbox as connectable", async () => {
    await seedConnection("needs_reauth");
    await seedDigestRoute();
    const res = await app.inject({ method: "POST", url: "/mail-digests" });
    expect(res.json()).toEqual({ error: "no_active_mailboxes" });
  });

  it("accepts with 202 once every precondition holds", async () => {
    await seedConnection();
    await seedDigestRoute();

    const res = await app.inject({ method: "POST", url: "/mail-digests" });

    // 202, never 200: the work was accepted, and a digest does NOT yet exist.
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true });
  });

  it("claims no digest_date, because the API cannot know it", async () => {
    // The zone is the worker's configuration. Inventing a date from the API's
    // clock would be a claim about a row that may be keyed differently.
    await seedConnection();
    await seedDigestRoute();
    const res = await app.inject({ method: "POST", url: "/mail-digests" });
    expect(Object.keys(res.json())).toEqual(["accepted"]);
  });

  it("WRITES NOTHING -- a request is not a digest", async () => {
    await seedConnection();
    await seedDigestRoute();
    await app.inject({ method: "POST", url: "/mail-digests" });
    expect(await app.db.select().from(mailDigests)).toHaveLength(0);
  });

  it("never overwrites a cached digest, whatever the outcome", async () => {
    // The no-overwrite guarantee migration 0014 demanded by name. This route
    // cannot violate it because it does not write at all -- asserted rather than
    // assumed, so a future edit that adds a write here fails here.
    await seedDigest({ content: { text: "yesterday's digest" } });
    await app.inject({ method: "POST", url: "/mail-digests" });

    const rows = await app.db.select().from(mailDigests);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toEqual({ text: "yesterday's digest" });
  });

  it("returns a static code on every failure path -- never provider text", async () => {
    await seedConnection();
    const res = await app.inject({ method: "POST", url: "/mail-digests" });
    const body: Record<string, unknown> = res.json();
    expect(Object.keys(body)).toEqual(["error"]);
    expect(typeof body["error"]).toBe("string");
    expect(body["error"]).toMatch(/^[a-z_]+$/);
  });
});

/** Typed accessor built on the real wire contract. */
function current(res: { json: () => unknown }): MailDigestCurrentResponse {
  return res.json() as MailDigestCurrentResponse;
}
