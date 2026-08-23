import {
  BriefRequestSchema,
  DailyBriefRecordSchema,
  type BriefContent,
  type DailyBriefRecord,
} from "@personal-os/schema";
import { ApiClientError, buildQuery, fetchJson } from "./client.js";

export type { BriefContent, DailyBriefRecord };

// POST /briefs (ADR-041: manual/on-demand only). Synchronous -- the server
// runs the bounded collector + single LLM call inline and returns the
// persisted record, not a 202/job handle.
export async function generateBrief(baseUrl: string, tz: string): Promise<DailyBriefRecord> {
  const parsed = BriefRequestSchema.parse({ tz });
  return fetchJson(baseUrl, "/briefs", DailyBriefRecordSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

// GET /briefs/current?tz= -- read-only lookup of the persisted brief for that
// timezone's local date. The API answers 404 when no brief has been
// generated yet for that (brief_date, timezone); that's a normal cold-start
// state, not a failure, so it's normalized to null here rather than left for
// every caller to reimplement -- same shape as
// apps/mobile/src/queries/reviews.ts's latestReviewOr404ToNull.
export async function getCurrentBrief(
  baseUrl: string,
  tz: string,
): Promise<DailyBriefRecord | null> {
  try {
    return await fetchJson(baseUrl, `/briefs/current${buildQuery({ tz })}`, DailyBriefRecordSchema);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
