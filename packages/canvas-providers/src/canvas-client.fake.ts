import { CanvasApiError } from "./canvas-client.js";
import type {
  CanvasAnnouncementApiShape,
  CanvasAssignmentApiShape,
  CanvasCalendarEventApiShape,
  CanvasClient,
  CanvasCourseApiShape,
  CanvasSelfResponse,
} from "./canvas-client.js";

// In-memory CanvasClient for tests. No network, ever.
//
// SCRIPTED RATHER THAN STATEFUL, mirroring
// packages/mail-providers/src/gmail-client.fake.ts's convention exactly: each
// method drains a FIFO queue of prepared responses, so a test states exactly
// what the provider returns on call 1, call 2, and so on.
//
// DRAINING AN EMPTY QUEUE FAILS THE CALL. A fake that returned an empty page
// for an unexpected call would produce a green test for code that made a
// call nobody intended -- the difference between "we tested the sync loop"
// and "the loop silently ran an extra time and we never knew".

type Scripted<T> = T | CanvasApiError;

export interface FakeCall {
  method:
    | "getSelf"
    | "listActiveCourses"
    | "listAssignments"
    | "listAnnouncements"
    | "listCalendarEvents";
  baseUrl: string;
  token: string;
  /** Present only for the three per-course methods. */
  courseId?: string;
}

export interface FakeCanvasClient extends CanvasClient {
  /** Every call made, in order, with the arguments it was given. */
  readonly calls: FakeCall[];
  queueSelf(response: Scripted<CanvasSelfResponse>): void;
  queueActiveCourses(response: Scripted<CanvasCourseApiShape[]>): void;
  queueAssignments(response: Scripted<CanvasAssignmentApiShape[]>): void;
  queueAnnouncements(response: Scripted<CanvasAnnouncementApiShape[]>): void;
  queueCalendarEvents(response: Scripted<CanvasCalendarEventApiShape[]>): void;
  /** Calls recorded for one method, in order. */
  callsFor(method: FakeCall["method"]): FakeCall[];
  /** Queue lengths, so a test can assert every scripted response was consumed. */
  pending(): Record<FakeCall["method"], number>;
  /**
   * Drops every queued response and every recorded call.
   *
   * Necessary, not merely convenient -- the identical reasoning
   * `FakeMailClient.reset` documents: a suite that builds one client and
   * injects it into every test shares these queues, and a failed test that
   * leaves a response unconsumed would otherwise leak into the next test's
   * queue and pass for a call nobody intended to exercise.
   */
  reset(): void;
}

function drain<T>(queue: Scripted<T>[], method: string): T {
  const next = queue.shift();
  if (next === undefined) {
    throw new Error(
      `FakeCanvasClient: unexpected call to ${method}() -- no response queued. ` +
        `Queue an expected response, or fix the code under test if this call was not intended.`,
    );
  }
  // A queued error is thrown rather than returned, so a test can script a
  // 401 (revoked token), a 404 (deleted course) or a rate-limited 403 exactly
  // where it wants one.
  if (next instanceof CanvasApiError) throw next;
  return next;
}

/**
 * Runs `fn` and returns a settled promise, so a drained-empty queue or a
 * scripted error REJECTS rather than throwing synchronously.
 *
 * Identical reasoning to `FakeMailClient`'s `settle`: the methods are
 * Promise-returning but not `async`, so a bare `throw` inside one would
 * escape before the promise exists, and a caller using `.rejects` would fail
 * for the wrong reason.
 */
function settle<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

export function createFakeCanvasClient(): FakeCanvasClient {
  const calls: FakeCall[] = [];
  const selves: Scripted<CanvasSelfResponse>[] = [];
  const courseLists: Scripted<CanvasCourseApiShape[]>[] = [];
  const assignmentLists: Scripted<CanvasAssignmentApiShape[]>[] = [];
  const announcementLists: Scripted<CanvasAnnouncementApiShape[]>[] = [];
  const calendarEventLists: Scripted<CanvasCalendarEventApiShape[]>[] = [];

  return {
    calls,
    queueSelf: (r) => void selves.push(r),
    queueActiveCourses: (r) => void courseLists.push(r),
    queueAssignments: (r) => void assignmentLists.push(r),
    queueAnnouncements: (r) => void announcementLists.push(r),
    queueCalendarEvents: (r) => void calendarEventLists.push(r),
    callsFor: (method) => calls.filter((c) => c.method === method),
    reset: () => {
      calls.length = 0;
      selves.length = 0;
      courseLists.length = 0;
      assignmentLists.length = 0;
      announcementLists.length = 0;
      calendarEventLists.length = 0;
    },
    pending: () => ({
      getSelf: selves.length,
      listActiveCourses: courseLists.length,
      listAssignments: assignmentLists.length,
      listAnnouncements: announcementLists.length,
      listCalendarEvents: calendarEventLists.length,
    }),

    getSelf(baseUrl: string, token: string): Promise<CanvasSelfResponse> {
      calls.push({ method: "getSelf", baseUrl, token });
      return settle(() => drain(selves, "getSelf"));
    },

    listActiveCourses(baseUrl: string, token: string): Promise<CanvasCourseApiShape[]> {
      calls.push({ method: "listActiveCourses", baseUrl, token });
      return settle(() => drain(courseLists, "listActiveCourses"));
    },

    listAssignments(
      baseUrl: string,
      token: string,
      courseId: string | number,
    ): Promise<CanvasAssignmentApiShape[]> {
      calls.push({ method: "listAssignments", baseUrl, token, courseId: String(courseId) });
      return settle(() => drain(assignmentLists, "listAssignments"));
    },

    listAnnouncements(
      baseUrl: string,
      token: string,
      courseId: string | number,
    ): Promise<CanvasAnnouncementApiShape[]> {
      calls.push({ method: "listAnnouncements", baseUrl, token, courseId: String(courseId) });
      return settle(() => drain(announcementLists, "listAnnouncements"));
    },

    listCalendarEvents(
      baseUrl: string,
      token: string,
      courseId: string | number,
    ): Promise<CanvasCalendarEventApiShape[]> {
      calls.push({ method: "listCalendarEvents", baseUrl, token, courseId: String(courseId) });
      return settle(() => drain(calendarEventLists, "listCalendarEvents"));
    },
  };
}
