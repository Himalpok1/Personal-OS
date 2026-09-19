import { errorToken } from "@personal-os/core/logging/logger";
import type { agents } from "@personal-os/db";
import {
  AgentRefusalSchema,
  AgentToolCallResponseSchema,
  READ_TOOL_INPUT_SCHEMAS,
  READ_TOOL_MAX_CALLS_PER_REQUEST,
  READ_TOOL_MAX_CHARS_PER_REQUEST,
  READ_TOOL_OUTPUT_SCHEMAS,
  READ_TOOL_PERMISSION,
  SearchPersonalItemsOutputSchema,
  type AgentBudget,
  type AgentRefusal,
  type AgentToolCallRequest,
  type AgentToolCallResponse,
  type AgentToolErrorClass,
  type AgentTrustLevel,
  type ReadToolInput,
  type ReadToolName,
} from "@personal-os/schema";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { authorizeAgentRead } from "../ask/authorize.js";
import { buildCalendarContext } from "../intelligence/calendar-context.js";
import { mintReadContext, type ReadContext } from "../intelligence/read-context.js";
import { buildTaskContext } from "../intelligence/task-context.js";
import { buildTodayContext } from "../intelligence/today-context.js";
import { budgetForCorrelation, callsInLastMinute } from "../read-models/agents.js";
import { isPermissionGranted } from "../read-models/actions.js";
import { getItemContext, searchPersonalItems } from "../search/service.js";
import { buildAcademicContext } from "./academic-tool.js";
import { checkBudget, refusalStatus } from "./budget.js";
import { recordToolCall } from "./service.js";

// The read-tool dispatcher (Checkpoint 10.9, ADR-081 §5): one call, in this
// order, every outcome audited.
//
//   1. input      READ_TOOL_INPUT_SCHEMAS[tool].safeParse  -> 400 input_invalid
//   2. permission READ_TOOL_PERMISSION[tool] under `agent` -> (checked in 3)
//   3. admission  checkBudget: trust -> permission -> rate -> calls -> chars
//                 -> 403 (owner's decisions) | 429 (gateway's limits)
//   4. dispatch   the SAME builders the Ask lane calls (today/calendar/task),
//                 the search service, or the academic projection
//   5. audit      recordToolCall with chars_returned = serialized length
//
// The read grant for the three intelligence builders is minted ONLY through
// `authorizeAgentRead` (ask/authorize.ts) -- the second and last mint site,
// one WeakSet, one `assertGrant`, no cast (Guard 3 and Guard 8 (c)). It
// never consults `ai_task_routes`: an agent reading through the gateway is
// not Cloud Ask, and the owner's Cloud Ask switch being OFF does not stop a
// granted agent from reading -- the agent's own grant is its consent.
//
// A refusal is audited (`refused`, never charged); a missing target is
// audited `failed` with `target_not_found` (charged as a call, 0 chars); a
// thrown tool is audited `failed` with `tool_failed` BEFORE the error is
// rethrown to the ordinary error handler (a 500 whose body is never the
// tool's output). Nothing here logs an input, an output or a title.

type AgentRow = typeof agents.$inferSelect;

/** Every read tool needs at least the `read` level; `none` is "registered, paused". */
const READ_TOOL_REQUIRED_TRUST: AgentTrustLevel = "read";

export type ReadToolResult =
  | { status: 200; body: AgentToolCallResponse }
  | { status: 400 | 403 | 404 | 429; body: AgentRefusal };

/** Thrown by a tool for "the thing you asked about does not exist": audited `failed`, answered 404. */
class TargetNotFoundError extends Error {
  constructor() {
    super("target not found");
    this.name = "TargetNotFoundError";
  }
}

function budgetView(correlationId: string, used: { calls: number; chars: number }): AgentBudget {
  return {
    correlation_id: correlationId,
    calls_used: used.calls,
    calls_max: READ_TOOL_MAX_CALLS_PER_REQUEST,
    chars_used: used.chars,
    chars_max: READ_TOOL_MAX_CHARS_PER_REQUEST,
  };
}

function typedInput<Name extends ReadToolName>(name: Name, value: unknown): ReadToolInput<Name> {
  return READ_TOOL_INPUT_SCHEMAS[name].parse(value) as ReadToolInput<Name>;
}

/**
 * Mints the intelligence read context for this call. `authorizeAgentRead`
 * returns null on a revoked agent, a trust level below `read` or an absent
 * grant -- every one of which `checkBudget` has already refused, so a null
 * here is a programming error surfaced as `trust_insufficient` rather than a
 * silent bypass.
 */
function mintAgentReadContext(
  app: FastifyInstance,
  request: FastifyRequest,
  agent: AgentRow,
  granted: boolean,
  tz: string,
  now: Date,
): ReadContext | null {
  const grant = authorizeAgentRead(request, agent, granted);
  if (grant === null) return null;
  return mintReadContext(request, app.db, grant, tz, now);
}

async function dispatch(
  app: FastifyInstance,
  request: FastifyRequest,
  agent: AgentRow,
  toolName: ReadToolName,
  rawInput: unknown,
  granted: boolean,
  now: Date,
): Promise<{ output: unknown } | { refusal: "trust_insufficient" }> {
  switch (toolName) {
    case "search_personal_items": {
      const input = typedInput("search_personal_items", rawInput);
      const response = await searchPersonalItems(app.db, {
        q: input.q,
        types: input.types,
        limit: input.limit,
        tz: null,
        includeArchived: false,
        order: "score",
        now,
      });
      const results = response.results.map((result) => ({
        type: result.type,
        id: result.id,
        title: result.title,
        preview: result.preview,
        timestamp: result.timestamp,
        score: result.score,
      }));
      return {
        output: SearchPersonalItemsOutputSchema.parse({
          results,
          truncated: response.truncated,
          citations: results.map((result) => ({ type: result.type, id: result.id })),
        }),
      };
    }
    case "get_item_context": {
      const input = typedInput("get_item_context", rawInput);
      const context = await getItemContext(app.db, input, { includeBody: true });
      if (context === null) throw new TargetNotFoundError();
      return { output: context };
    }
    case "get_today_context": {
      const input = typedInput("get_today_context", rawInput);
      const ctx = mintAgentReadContext(app, request, agent, granted, input.tz, now);
      if (ctx === null) return { refusal: "trust_insufficient" };
      return { output: (await buildTodayContext(ctx)).context };
    }
    case "get_calendar_context": {
      const input = typedInput("get_calendar_context", rawInput);
      const ctx = mintAgentReadContext(app, request, agent, granted, input.tz, now);
      if (ctx === null) return { refusal: "trust_insufficient" };
      return { output: await buildCalendarContext(ctx, input) };
    }
    case "get_task_context": {
      const input = typedInput("get_task_context", rawInput);
      // The task tool carries no zone of its own; every instant it returns is
      // an ISO timestamp, so the read context's zone is UTC by convention.
      const ctx = mintAgentReadContext(app, request, agent, granted, "UTC", now);
      if (ctx === null) return { refusal: "trust_insufficient" };
      const output = await buildTaskContext(ctx, input);
      if (output === null) throw new TargetNotFoundError();
      return { output };
    }
    case "get_academic_context": {
      const input = typedInput("get_academic_context", rawInput);
      return { output: await buildAcademicContext(app.db, input, now) };
    }
  }
}

export async function runReadTool(
  app: FastifyInstance,
  request: FastifyRequest,
  agent: AgentRow,
  toolName: ReadToolName,
  body: AgentToolCallRequest,
  now: Date,
): Promise<ReadToolResult> {
  const startedAt = Date.now();
  const correlationId = body.correlation_id;

  const audit = async (
    status: "completed" | "refused" | "failed",
    errorClass: AgentToolErrorClass | null,
    charsReturned: number,
  ): Promise<void> => {
    await recordToolCall(app.db, {
      agentId: agent.id,
      correlationId,
      toolName,
      status,
      errorClass,
      charsReturned,
      durationMs: Math.max(0, Date.now() - startedAt),
      calledAt: now,
    });
    app.log.info(
      { agentId: agent.id, toolName, correlationId, status, errorClass: errorClass ?? undefined },
      status === "completed" ? "agent.tool.completed" : `agent.tool.${status}`,
    );
  };

  const refuse = async (
    errorClass: AgentToolErrorClass,
    used: { calls: number; chars: number },
    auditStatus: "refused" | "failed" = "refused",
  ): Promise<ReadToolResult> => {
    await audit(auditStatus, errorClass, 0);
    return {
      status: refusalStatus(errorClass),
      body: AgentRefusalSchema.parse({
        error: "agent_tool_refused",
        error_class: errorClass,
        budget: budgetView(correlationId, used),
      }),
    };
  };

  // 1. The input, before anything is read: a malformed call is refused with
  //    a token, and the schema's own issues are never echoed to the agent.
  const parsed = READ_TOOL_INPUT_SCHEMAS[toolName].safeParse(body.input);

  // 2 + 3. The owner's decisions, then the gateway's limits.
  const permission = READ_TOOL_PERMISSION[toolName];
  const granted = await isPermissionGranted(app.db, "agent", permission);
  const [used, lastMinute] = await Promise.all([
    budgetForCorrelation(app.db, correlationId),
    callsInLastMinute(app.db, agent.id, now),
  ]);
  const level = agent.trustLevel as AgentTrustLevel;

  if (!parsed.success) return refuse("input_invalid", used);

  const refusal = checkBudget({
    trustLevel: level,
    requiredTrust: READ_TOOL_REQUIRED_TRUST,
    permissionGranted: granted,
    calls: used.calls,
    chars: used.chars,
    lastMinute,
  });
  if (refusal !== null) return refuse(refusal, used);

  // 4. Dispatch. A missing target is a recorded failure (charged as a call,
  //    0 chars); any other throw is recorded as `tool_failed` and rethrown.
  let result: Awaited<ReturnType<typeof dispatch>>;
  try {
    result = await dispatch(app, request, agent, toolName, parsed.data, granted, now);
  } catch (err: unknown) {
    if (err instanceof TargetNotFoundError) {
      return refuse("target_not_found", used, "failed");
    }
    await audit("failed", "tool_failed", 0);
    app.log.error(
      { agentId: agent.id, toolName, correlationId, error: errorToken(err) },
      "agent.tool.failed: unexpected failure",
    );
    throw err;
  }
  if ("refusal" in result) return refuse(result.refusal, used);

  // 5. The output is re-validated through its own strict schema before it
  //    leaves, so a builder change can never widen what an agent receives.
  const output: unknown = READ_TOOL_OUTPUT_SCHEMAS[toolName].parse(result.output);
  const charsReturned = JSON.stringify(output).length;
  await audit("completed", null, charsReturned);
  return {
    status: 200,
    body: AgentToolCallResponseSchema.parse({
      tool_name: toolName,
      correlation_id: correlationId,
      output,
      budget: budgetView(correlationId, {
        calls: used.calls + 1,
        chars: used.chars + charsReturned,
      }),
    }),
  };
}
