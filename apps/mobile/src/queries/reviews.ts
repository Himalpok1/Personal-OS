import { ApiClientError } from "@personal-os/api-client";
import type { ReviewKind, ReviewUpdate } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { deviceTimezone } from "./today";

// The API answers GET /reviews/latest with 404 when no review of that kind
// exists yet. That is a normal cold-start state, not a failure, so the queryFn
// normalizes it to null instead of surfacing an error state to screens.
async function latestReviewOr404ToNull(kind: ReviewKind) {
  try {
    return await api.getLatestReview(kind);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

// Each context gets its own literal-typed queryFn (no shared union-returning
// helper): TanStack's queryFn/key generics cannot unify the two unrelated
// context shapes, and per-hook literals keep the cache keys exact.
export function useDailyReviewContext() {
  return useQuery({
    queryKey: ["review-context", "daily"],
    queryFn: () => api.getDailyReviewContext(deviceTimezone()),
  });
}

export function useWeeklyReviewContext() {
  return useQuery({
    queryKey: ["review-context", "weekly"],
    queryFn: () => api.getWeeklyReviewContext(deviceTimezone()),
  });
}

export function useLatestReview(kind: ReviewKind) {
  return useQuery({
    queryKey: ["reviews", "latest", kind],
    queryFn: () => latestReviewOr404ToNull(kind),
  });
}

// Every review write touches today's rollups (a completed review changes what
// "start review" should do next) plus whichever contexts/reviews are cached.
function useInvalidateReviews() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["reviews"] });
    void queryClient.invalidateQueries({ queryKey: ["review-context"] });
    void queryClient.invalidateQueries({ queryKey: ["today"] });
  };
}

export function useStartReview() {
  const invalidate = useInvalidateReviews();
  const queryClient = useQueryClient();
  return useMutation({
    // period_start comes from the server-computed context (cache-first,
    // refetched only if stale) -- the client never derives the review period
    // itself, mirroring how today's date math lives behind the API.
    mutationFn: async (kind: ReviewKind) => {
      const context =
        kind === "daily"
          ? await queryClient.ensureQueryData({
              queryKey: ["review-context", "daily"],
              queryFn: () => api.getDailyReviewContext(deviceTimezone()),
            })
          : await queryClient.ensureQueryData({
              queryKey: ["review-context", "weekly"],
              queryFn: () => api.getWeeklyReviewContext(deviceTimezone()),
            });
      return api.createReview({
        kind,
        period_start: context.period_start,
        tz: deviceTimezone(),
      });
    },
    onSuccess: invalidate,
  });
}

export function useSaveReview() {
  const invalidate = useInvalidateReviews();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ReviewUpdate }) =>
      api.updateReview(id, patch),
    onSuccess: invalidate,
  });
}

export function useCompleteReview() {
  const invalidate = useInvalidateReviews();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.completeReview(id),
    onSuccess: invalidate,
  });
}

export function useSkipReview() {
  const invalidate = useInvalidateReviews();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.skipReview(id),
    onSuccess: invalidate,
  });
}
