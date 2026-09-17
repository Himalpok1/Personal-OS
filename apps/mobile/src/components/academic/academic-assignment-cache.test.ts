import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  assignmentLabelQueryKey,
  rememberAcademicAssignments,
  type LinkedAssignmentSummary,
} from "./academic-assignment-cache";
import { assignment } from "./fixtures.test-support";

// No render harness in this app (see queries/ask.test.ts) -- the cache write
// is proven with a real QueryClient/QueryObserver, exactly how tasks.test.ts
// and focus.test.ts drive a mutation through a real MutationObserver instead
// of mocking @tanstack/react-query.

// A disabled QueryObserver only updates its `getCurrentResult()` snapshot
// once something subscribes to it -- exactly what mounting a component with
// the equivalent `useQuery` call does -- so every observer here is
// subscribed with a no-op listener, matching how tasks/[id].tsx's own
// disabled useQuery read (this module's real caller) is actually mounted.
function observerFor(queryClient: QueryClient, id: string) {
  const observer = new QueryObserver<LinkedAssignmentSummary | undefined>(queryClient, {
    queryKey: assignmentLabelQueryKey(id),
    queryFn: () => Promise.resolve(undefined),
    enabled: false,
    staleTime: Infinity,
  });
  observer.subscribe(() => {});
  return observer;
}

describe("rememberAcademicAssignments", () => {
  it("writes each assignment's title and course label, keyed by id, readable by a disabled query", () => {
    const queryClient = new QueryClient();
    const observer = observerFor(queryClient, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(observer.getCurrentResult().data).toBeUndefined();

    rememberAcademicAssignments(queryClient, [
      assignment({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Project milestone 2",
        course_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        course_code: "INSY 4315",
        course_name: "Advanced Web Development",
      }),
    ]);

    expect(observer.getCurrentResult().data).toEqual({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Project milestone 2",
      courseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      courseLabel: "INSY 4315",
    });
  });

  it("falls back to the course name when there is no code, matching courseLabel elsewhere", () => {
    const queryClient = new QueryClient();
    const observer = observerFor(queryClient, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    rememberAcademicAssignments(queryClient, [
      assignment({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        course_code: null,
        course_name: "Advanced Web Development",
      }),
    ]);

    expect(observer.getCurrentResult().data?.courseLabel).toBe("Advanced Web Development");
  });

  it("never touches a different assignment's cached entry", () => {
    const queryClient = new QueryClient();
    const other = observerFor(queryClient, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");

    rememberAcademicAssignments(queryClient, [
      assignment({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }),
    ]);

    expect(other.getCurrentResult().data).toBeUndefined();
  });

  it("writes nothing for an empty list", () => {
    const queryClient = new QueryClient();
    expect(() => rememberAcademicAssignments(queryClient, [])).not.toThrow();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
