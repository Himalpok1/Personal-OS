import type { agents, Db } from "@personal-os/db";
import {
  ACTION_IDS,
  ACTION_INPUT_SCHEMAS,
  ACTION_REGISTRY,
  AGENT_CONTRACT_VERSION,
  AGENT_TOOL_CALLS_PER_MINUTE,
  AgentManifestSchema,
  READ_TOOL_DESCRIPTIONS,
  READ_TOOL_INPUT_SCHEMAS,
  READ_TOOL_MAX_CALLS_PER_REQUEST,
  READ_TOOL_MAX_CHARS_PER_REQUEST,
  READ_TOOL_NAMES,
  READ_TOOL_OUTPUT_SCHEMAS,
  READ_TOOL_PERMISSION,
  READ_TOOL_SENSITIVITY,
  type AgentManifest,
  type AgentTrustLevel,
} from "@personal-os/schema";
import { z } from "zod";
import { listAgentPermissionGrants } from "../read-models/actions.js";

// GET /agent/manifest (Checkpoint 10.9, ADR-081 §5): what an authenticated
// agent may call and request, described from the SAME constants the gateway
// enforces with -- `READ_TOOL_NAMES` × permission × sensitivity × Zod I/O
// schemas rendered to JSON Schema by zod's own `z.toJSONSchema`, and
// `ACTION_IDS` × the registry × input schemas. There is no second list to
// drift: a tool the manifest does not describe cannot be called, and a tool
// it describes is exactly the one `runReadTool` dispatches.
//
// `validation: "server-side"` says what the JSON Schema is: descriptive.
// Every input is re-parsed through the Zod schema on the call; the manifest
// helps an agent build a well-formed request, it never widens what the
// server accepts. `contract_version` changes whenever any of this changes
// shape. The grants are the agent principal's live ones, so an agent can
// see which tools the owner has switched on without trying each.

type AgentRow = typeof agents.$inferSelect;

const JSON_SCHEMA_INPUT = { io: "input", unrepresentable: "any" } as const;
const JSON_SCHEMA_OUTPUT = { io: "output", unrepresentable: "any" } as const;

export async function buildAgentManifest(db: Db, agent: AgentRow): Promise<AgentManifest> {
  const grants = await listAgentPermissionGrants(db);
  return AgentManifestSchema.parse({
    contract_version: AGENT_CONTRACT_VERSION,
    agent: { id: agent.id, name: agent.name, trust_level: agent.trustLevel as AgentTrustLevel },
    budgets: {
      calls_per_correlation: READ_TOOL_MAX_CALLS_PER_REQUEST,
      chars_per_correlation: READ_TOOL_MAX_CHARS_PER_REQUEST,
      calls_per_minute: AGENT_TOOL_CALLS_PER_MINUTE,
    },
    validation: "server-side",
    tools: READ_TOOL_NAMES.map((name) => ({
      tool_id: name,
      name: READ_TOOL_DESCRIPTIONS[name].name,
      description: READ_TOOL_DESCRIPTIONS[name].description,
      classification: "read",
      permission: READ_TOOL_PERMISSION[name],
      sensitivity: READ_TOOL_SENSITIVITY[name],
      audited: true,
      input_schema: z.toJSONSchema(READ_TOOL_INPUT_SCHEMAS[name], JSON_SCHEMA_INPUT),
      output_schema: z.toJSONSchema(READ_TOOL_OUTPUT_SCHEMAS[name], JSON_SCHEMA_OUTPUT),
    })),
    actions: ACTION_IDS.map((id) => {
      const definition = ACTION_REGISTRY[id];
      return {
        action_id: id,
        name: definition.name,
        description: definition.description,
        classification: "action",
        category: definition.category,
        permission: definition.permission,
        risk: definition.risk,
        reversibility: definition.reversibility,
        target_type: definition.target_type,
        requires_approval: true,
        audited: true,
        input_schema: z.toJSONSchema(ACTION_INPUT_SCHEMAS[id], JSON_SCHEMA_INPUT),
      };
    }),
    grants: grants.items,
  });
}
