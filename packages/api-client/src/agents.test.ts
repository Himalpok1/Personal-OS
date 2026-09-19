import { afterEach, describe, expect, it, vi } from "vitest";
import { approveAction, cancelAction, updatePermission } from "./actions.js";
import {
  listAgentPermissions,
  listAgents,
  registerAgent,
  revokeAgent,
  updateAgentPermission,
} from "./agents.js";

const agentRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "curl-agent",
  trust_level: "propose",
  disclosure_version: "2026-09-18",
  created_at: "2026-09-18T00:00:00.000Z",
  updated_at: "2026-09-18T00:00:00.000Z",
  last_seen_at: null,
  revoked_at: null,
};

describe("agents api-client (Checkpoint 10.9)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(body: unknown, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    global.fetch = fetchMock;
    return fetchMock;
  }

  function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    return [url.toString(), init];
  }

  it("registers with the device token, sends a trimmed body, and surfaces the token once", async () => {
    const fetchMock = mockFetch({ agent: agentRow, token: "posa_raw" }, 201);
    const result = await registerAgent("http://localhost:3000", "device-token", {
      name: "  curl-agent ",
      trust_level: "propose",
    });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://localhost:3000/agents");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer device-token");
    expect(JSON.parse(init.body as string)).toEqual({ name: "curl-agent", trust_level: "propose" });
    expect(result.token).toBe("posa_raw");
  });

  it("refuses a token without the agent prefix in the response", async () => {
    mockFetch({ agent: agentRow, token: "raw" }, 201);
    await expect(
      registerAgent("http://localhost:3000", "t", { name: "a", trust_level: "read" }),
    ).rejects.toThrow();
  });

  it("every owner route carries the device bearer", async () => {
    for (const [fn, path] of [
      [() => listAgents("http://h", "t"), "http://h/agents"],
      [() => revokeAgent("http://h", "t", agentRow.id), `http://h/agents/${agentRow.id}/revoke`],
      [() => listAgentPermissions("http://h", "t"), "http://h/permissions/agent"],
      [
        () => updateAgentPermission("http://h", "t", "context.read", { granted: true }),
        "http://h/permissions/agent/context.read",
      ],
    ] as const) {
      const fetchMock = mockFetch(
        path.endsWith("/agents")
          ? { items: [] }
          : path.endsWith("/revoke")
            ? { ...agentRow, revoked_at: "2026-09-18T01:00:00.000Z" }
            : path.endsWith("/permissions/agent")
              ? { disclosure_version: "2026-09-17", items: [] }
              : {
                  item: {
                    permission: "context.read",
                    principal: "agent",
                    kind: "read",
                    category: "context",
                    label: "x",
                    description: "y",
                    granted: true,
                    granted_at: "2026-09-18T01:00:00.000Z",
                    revoked_at: null,
                    disclosure_version: "2026-09-17",
                    needs_reconsent: false,
                    action_ids: [],
                    tool_names: ["get_today_context"],
                  },
                  cancelled_pending: 0,
                },
      );
      await fn();
      const [url, init] = lastCall(fetchMock);
      expect(url).toBe(path);
      expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer t");
    }
  });

  it("approve, cancel and the app permission PATCH are device-bound too (ADR-082)", async () => {
    const request = {
      id: agentRow.id,
      client_uuid: null,
      action_id: "create_task",
      input: {},
      principal: "app",
      status: "completed",
      source: "manual",
      source_ref: null,
      reason: null,
      input_summary: "x",
      result_summary: null,
      target_type: null,
      target_id: null,
      error_class: null,
      reverses_request_id: null,
      requested_at: "2026-09-18T00:00:00.000Z",
      expires_at: "2026-09-19T00:00:00.000Z",
      approved_at: null,
      finished_at: null,
      reversed_by_request_id: null,
    };
    let fetchMock = mockFetch(request);
    await approveAction("http://h", "t", agentRow.id);
    expect((lastCall(fetchMock)[1].headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer t",
    );
    fetchMock = mockFetch(request);
    await cancelAction("http://h", "t", agentRow.id);
    expect((lastCall(fetchMock)[1].headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer t",
    );
    fetchMock = mockFetch({
      item: {
        permission: "tasks.write",
        principal: "app",
        label: "x",
        description: "y",
        category: "tasks",
        granted: false,
        granted_at: null,
        revoked_at: "2026-09-18T01:00:00.000Z",
        disclosure_version: "2026-09-17",
        needs_reconsent: false,
        usage_count: 0,
        last_used_at: null,
        action_ids: [],
      },
      cancelled_pending: 0,
    });
    await updatePermission("http://h", "t", "tasks.write", { granted: false });
    const [, init] = lastCall(fetchMock);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer t");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});
