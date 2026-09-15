import {
  AskRequestSchema,
  AskResponseSchema,
  type AskRequest,
  type AskResponse,
} from "@personal-os/schema";
import { fetchJson } from "./client.js";

export type { AskRequest, AskResponse };

/**
 * POST /ask (Checkpoint 8.6B; widened in 9.7). Synchronous -- the server runs
 * retrieval, redaction and the one model call inline and returns the answer,
 * not a job handle. The request is parsed through the same schema the server
 * enforces before it is sent, so an obviously-too-short or too-long question
 * fails locally rather than round-tripping for a 400.
 *
 * `tz` turns on the Today context ("Ask about today"); `scope: "today"` is
 * what the preset chips send -- no note/task body is selected server-side for
 * a preset. A bare `{ question }` is the 8.6B request and gets the 8.6B
 * response shape.
 */
export async function askCloud(baseUrl: string, request: AskRequest): Promise<AskResponse> {
  const parsed = AskRequestSchema.parse(request);
  return fetchJson(baseUrl, "/ask", AskResponseSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}
