import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectCanvas,
  disconnectCanvasConnection,
  getCanvasConnection,
  listCanvasConnections,
  listCanvasSyncRuns,
  listUpcomingCanvasAssignments,
  triggerCanvasSync,
} from "./canvas.js";

const BASE = "http://localhost:3000";
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function stub(body: unknown, status = 200) {
  const f = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  global.fetch = f;
  return f;
}

const CONNECTION = {
  id: "11111111-1111-4111-8111-111111111111",
  canvas_base_url: "https://uta.instructure.com",
  canvas_user_id: 12345,
  canvas_user_name: "Jane Doe",
  status: "active",
  last_sync_at: null,
  last_sync_error: null,
  last_sync_error_at: null,
  created_at: "2026-09-15T12:00:00Z",
  updated_at: "2026-09-15T12:00:00Z",
};

const SYNC_RUN = {
  id: "22222222-2222-4222-8222-222222222222",
  connection_id: CONNECTION.id,
  kind: "manual",
  status: "succeeded",
  started_at: "2026-09-15T12:00:00Z",
  finished_at: "2026-09-15T12:00:05Z",
  courses_synced: 16,
  assignments_synced: 42,
  announcements_synced: 5,
  events_synced: 0,
  failure_class: null,
  error_message: null,
};

describe("listCanvasConnections", () => {
  it("returns the configured flag alongside the items", async () => {
    stub({ configured: true, items: [CONNECTION] });
    const result = await listCanvasConnections(BASE);
    // `configured` is what lets a client tell "no Canvas connection yet"
    // from "this server cannot connect one" -- different states needing
    // different words, the same distinction `listMailConnections` makes.
    expect(result.configured).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.canvas_user_name).toBe("Jane Doe");
  });

  it("requests the exact path with no query string", async () => {
    const f = stub({ configured: false, items: [] });
    await listCanvasConnections(BASE);
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/canvas-connections`);
  });

  it("REJECTS a response carrying prose in last_sync_error", async () => {
    // last_sync_error is typed to CanvasSyncTokenSchema's token-shaped
    // regex, so provider prose is a parse failure at the client boundary
    // too -- mirroring listMailConnections' identical guard over the
    // closed MailSyncErrorCode enum.
    stub({
      configured: true,
      items: [{ ...CONNECTION, last_sync_error: "The token you supplied is invalid." }],
    });
    await expect(listCanvasConnections(BASE)).rejects.toThrow();
  });

  it("accepts a token-shaped error code", async () => {
    stub({ configured: true, items: [{ ...CONNECTION, last_sync_error: "auth_failed" }] });
    const result = await listCanvasConnections(BASE);
    expect(result.items[0]?.last_sync_error).toBe("auth_failed");
  });

  it("REJECTS a response carrying a credential-shaped field", async () => {
    // CanvasConnectionSchema is `.strict()`, unlike MailConnectionSchema --
    // an extra key is a parse failure here, not a silent drop. Nothing in
    // this schema can express an access token, ciphertext, an IV or an auth
    // tag (the file header's structural proof), so a server regression that
    // leaked one would fail loudly at this boundary.
    stub({
      configured: true,
      items: [{ ...CONNECTION, access_token: "leaked-pat-value" }],
    });
    await expect(listCanvasConnections(BASE)).rejects.toThrow();
  });
});

describe("getCanvasConnection", () => {
  it("percent-encodes the id", async () => {
    const f = stub(CONNECTION);
    await getCanvasConnection(BASE, "a/b");
    const [url] = f.mock.calls[0] as [URL];
    expect(url.pathname).toBe("/canvas-connections/a%2Fb");
  });

  it("parses a well-formed connection", async () => {
    stub(CONNECTION);
    const result = await getCanvasConnection(BASE, CONNECTION.id);
    expect(result.canvas_base_url).toBe("https://uta.instructure.com");
    expect(result.status).toBe("active");
  });
});

describe("connectCanvas", () => {
  it("POSTs the base URL and PAT with a JSON content type", async () => {
    const f = stub(CONNECTION, 201);
    await connectCanvas(BASE, {
      base_url: "https://uta.instructure.com",
      personal_access_token: "1234~abcdef",
    });
    const [url, init] = f.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`${BASE}/canvas-connections`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(typeof init.body === "string" ? init.body : "{}")).toEqual({
      base_url: "https://uta.instructure.com",
      personal_access_token: "1234~abcdef",
    });
  });

  it("resolves the created connection", async () => {
    stub(CONNECTION, 201);
    const result = await connectCanvas(BASE, {
      base_url: "https://uta.instructure.com",
      personal_access_token: "1234~abcdef",
    });
    expect(result.id).toBe(CONNECTION.id);
  });

  it("surfaces an invalid-token failure with its own code", async () => {
    stub({ error: "invalid_token" }, 400);
    await expect(
      connectCanvas(BASE, {
        base_url: "https://uta.instructure.com",
        personal_access_token: "bad",
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_token" });
  });
});

describe("disconnectCanvasConnection", () => {
  it("POSTs and resolves the updated connection directly (no revoked flag)", async () => {
    const f = stub({ ...CONNECTION, status: "disconnected" });
    const result = await disconnectCanvasConnection(BASE, CONNECTION.id);
    const [url, init] = f.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe(`/canvas-connections/${CONNECTION.id}/disconnect`);
    expect(init.method).toBe("POST");
    // Unlike disconnectMailConnection, there is no OAuth grant to revoke and
    // therefore no separate `revoked` boolean -- the response IS the
    // updated connection.
    expect(result.status).toBe("disconnected");
    expect("revoked" in (result as object)).toBe(false);
  });

  it("sends no Content-Type on a bodyless POST", async () => {
    // The same Fastify FST_ERR_CTP_EMPTY_JSON_BODY hazard disconnectMailConnection
    // and generateMailDigest already guard against.
    const f = stub({ ...CONNECTION, status: "disconnected" });
    await disconnectCanvasConnection(BASE, CONNECTION.id);
    const [, init] = f.mock.calls[0] as [URL, RequestInit];
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });
});

describe("triggerCanvasSync", () => {
  it("POSTs to the sync route and sends no Content-Type", async () => {
    const f = stub({ queued: true }, 202);
    await triggerCanvasSync(BASE, CONNECTION.id);
    const [url, init] = f.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe(`/canvas-connections/${CONNECTION.id}/sync`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("resolves an ACKNOWLEDGEMENT, never synced data", async () => {
    stub({ queued: true }, 202);
    expect(await triggerCanvasSync(BASE, CONNECTION.id)).toEqual({ queued: true });
  });

  it("surfaces a 409 precondition with its own code", async () => {
    stub({ error: "canvas_not_configured" }, 409);
    await expect(triggerCanvasSync(BASE, CONNECTION.id)).rejects.toMatchObject({
      status: 409,
      code: "canvas_not_configured",
    });
  });
});

describe("listCanvasSyncRuns", () => {
  it("requests no query string when limit is omitted", async () => {
    const f = stub({ items: [SYNC_RUN] });
    await listCanvasSyncRuns(BASE, CONNECTION.id);
    expect(String(f.mock.calls[0]![0])).toBe(
      `${BASE}/canvas-connections/${CONNECTION.id}/sync-runs`,
    );
  });

  it("appends limit as a query param when given", async () => {
    const f = stub({ items: [SYNC_RUN] });
    await listCanvasSyncRuns(BASE, CONNECTION.id, 5);
    const [url] = f.mock.calls[0] as [URL];
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("parses the per-entity-kind sync counts", async () => {
    stub({ items: [SYNC_RUN] });
    const result = await listCanvasSyncRuns(BASE, CONNECTION.id);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.courses_synced).toBe(16);
    expect(result.items[0]?.status).toBe("succeeded");
  });

  it("REJECTS a run carrying prose in error_message", async () => {
    // error_message is CanvasSyncTokenSchema too -- provider prose from a
    // Canvas error body must never reach a client the same way it must
    // never reach a log line or a database column (ADR-068 §5).
    stub({
      items: [{ ...SYNC_RUN, status: "failed", error_message: "Rate limit exceeded, try again." }],
    });
    await expect(listCanvasSyncRuns(BASE, CONNECTION.id)).rejects.toThrow();
  });

  it("percent-encodes the connection id", async () => {
    const f = stub({ items: [] });
    await listCanvasSyncRuns(BASE, "a/b");
    const [url] = f.mock.calls[0] as [URL];
    expect(url.pathname).toBe("/canvas-connections/a%2Fb/sync-runs");
  });
});

const UPCOMING_ASSIGNMENT = {
  id: "22222222-2222-4222-8222-222222222222",
  course_id: "33333333-3333-4333-8333-333333333333",
  canvas_assignment_id: 987,
  title: "Homework 3",
  due_at: "2026-09-18T05:00:00Z",
  points_possible: 20,
  submission_types: ["online_upload"],
  html_url: "https://uta.instructure.com/courses/1/assignments/987",
  published: true,
  submission_state: "unsubmitted",
  submission_missing: false,
  submission_late: false,
  submitted_at: null,
  archived_at: null,
  course_name: "Real Analysis",
  canvas_base_url: "https://uta.instructure.com",
};

describe("listUpcomingCanvasAssignments", () => {
  it("requests no query string when withinDays is omitted", async () => {
    const f = stub({ items: [UPCOMING_ASSIGNMENT] });
    await listUpcomingCanvasAssignments(BASE);
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/canvas-assignments/upcoming`);
  });

  it("appends within_days as a query param when given", async () => {
    const f = stub({ items: [UPCOMING_ASSIGNMENT] });
    await listUpcomingCanvasAssignments(BASE, 14);
    const [url] = f.mock.calls[0] as [URL];
    expect(url.searchParams.get("within_days")).toBe("14");
  });

  it("parses the course name denormalized onto the assignment", async () => {
    stub({ items: [UPCOMING_ASSIGNMENT] });
    const result = await listUpcomingCanvasAssignments(BASE);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.course_name).toBe("Real Analysis");
    expect(result.items[0]?.title).toBe("Homework 3");
  });

  it("REJECTS an assignment carrying a description or score field", async () => {
    // Structural regression test at the client boundary too: .strict() means
    // an extra key -- one a compromised or buggy server tacked on -- fails to
    // parse rather than being silently accepted (ADR-068 §3).
    stub({ items: [{ ...UPCOMING_ASSIGNMENT, description: "<p>full prompt</p>" }] });
    await expect(listUpcomingCanvasAssignments(BASE)).rejects.toThrow();
  });
});
