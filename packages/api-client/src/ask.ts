import { AskRequestSchema, AskResponseSchema, type AskResponse } from "@personal-os/schema";
import { fetchJson } from "./client.js";

export type { AskResponse };

/**
 * POST /ask (Checkpoint 8.6B). Synchronous -- the server runs retrieval,
 * redaction and the one model call inline and returns the answer, not a job
 * handle. `question` is parsed through the same schema the server enforces
 * before it is sent, so an obviously-too-short or too-long question fails
 * locally rather than round-tripping for a 400.
 */
export async function askCloud(baseUrl: string, question: string): Promise<AskResponse> {
  const parsed = AskRequestSchema.parse({ question });
  return fetchJson(baseUrl, "/ask", AskResponseSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}
