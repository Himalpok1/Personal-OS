import {
  DailyReviewContextSchema,
  ReviewCreateSchema,
  ReviewKindSchema,
  ReviewListQuerySchema,
  ReviewSchema,
  ReviewUpdateSchema,
  WeeklyReviewContextSchema,
  paginatedResponseSchema,
  type Review,
  type ReviewCreate,
  type ReviewKind,
  type ReviewListQuery,
  type ReviewStatus,
  type ReviewUpdate,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

export type { Review, ReviewCreate, ReviewKind, ReviewListQuery, ReviewStatus, ReviewUpdate };

const ReviewListResponseSchema = paginatedResponseSchema(ReviewSchema);

// POST /reviews upserts on (kind, period_start) server-side, so the client
// exposes no separate update-on-create path.
export async function createReview(baseUrl: string, input: ReviewCreate): Promise<Review> {
  const parsed = ReviewCreateSchema.parse(input);
  return fetchJson(baseUrl, "/reviews", ReviewSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

// Client-side query, not the server's raw querystring shape -- same
// parse-then-serialize taste as listOccurrences (applies limit/offset
// defaults into the URL the way the wire expects them).
export async function listReviews(baseUrl: string, query: ReviewListQuery) {
  const parsed = ReviewListQuerySchema.parse(query);
  return fetchJson(baseUrl, `/reviews${buildQuery(parsed)}`, ReviewListResponseSchema);
}

// Most recent review of a kind -- the "resume where you left off" entry
// point. Throws ApiClientError with status 404 when none exists yet.
export async function getLatestReview(baseUrl: string, kind: ReviewKind): Promise<Review> {
  const parsed = ReviewKindSchema.parse(kind);
  return fetchJson(baseUrl, `/reviews/latest${buildQuery({ kind: parsed })}`, ReviewSchema);
}

export async function getReview(baseUrl: string, id: string): Promise<Review> {
  return fetchJson(baseUrl, `/reviews/${id}`, ReviewSchema);
}

export async function updateReview(
  baseUrl: string,
  id: string,
  patch: ReviewUpdate,
): Promise<Review> {
  const parsed = ReviewUpdateSchema.parse(patch);
  return fetchJson(baseUrl, `/reviews/${id}`, ReviewSchema, {
    method: "PATCH",
    body: JSON.stringify(parsed),
  });
}

// Lifecycle actions are bodyless POSTs exactly like archiveTask/pauseProject:
// fetchJson only sets Content-Type when a body exists (a JSON Content-Type on
// an empty body is rejected by Fastify's parser as a spurious 400).
async function postReviewAction(baseUrl: string, id: string, action: string): Promise<Review> {
  return fetchJson(baseUrl, `/reviews/${id}/${action}`, ReviewSchema, { method: "POST" });
}

export function completeReview(baseUrl: string, id: string): Promise<Review> {
  return postReviewAction(baseUrl, id, "complete");
}

export function skipReview(baseUrl: string, id: string): Promise<Review> {
  return postReviewAction(baseUrl, id, "skip");
}

export async function getDailyReviewContext(baseUrl: string, tz: string) {
  return fetchJson(
    baseUrl,
    `/reviews/context/daily${buildQuery({ tz })}`,
    DailyReviewContextSchema,
  );
}

export async function getWeeklyReviewContext(baseUrl: string, tz: string) {
  return fetchJson(
    baseUrl,
    `/reviews/context/weekly${buildQuery({ tz })}`,
    WeeklyReviewContextSchema,
  );
}
