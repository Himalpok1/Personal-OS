import {
  FocusSuggestionRequestSchema,
  FocusSuggestionResponseSchema,
  type FocusSuggestionRequest,
  type FocusSuggestionResponse,
} from "@personal-os/schema";
import { fetchJson } from "./client.js";

export type { FocusSuggestionRequest, FocusSuggestionResponse };

/**
 * POST /focus/suggestion (Checkpoint 9.8). Synchronous, mirroring `askCloud`
 * -- the server runs the one model call inline and returns the suggestion,
 * not a job handle. `tz` is required (there is no "today-less" mode). A
 * `409 focus_not_enough_candidates` means the server independently recomputed
 * the candidate count and found fewer than `FOCUS_MIN_CANDIDATES` -- the
 * caller is expected to have already hidden the affordance in that case, this
 * is defense in depth, not the primary gate.
 */
export async function suggestFocus(
  baseUrl: string,
  request: FocusSuggestionRequest,
): Promise<FocusSuggestionResponse> {
  const parsed = FocusSuggestionRequestSchema.parse(request);
  return fetchJson(baseUrl, "/focus/suggestion", FocusSuggestionResponseSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}
