import { canvasConnections, type Db } from "@personal-os/db";
import { decryptSecret, type EncryptedSecret } from "@personal-os/ai-providers";
import {
  classifyCanvasFault,
  translateCanvasAnnouncement,
  translateCanvasAssignment,
  translateCanvasCalendarEvent,
  translateCanvasCourse,
  type CanvasAnnouncementRow,
  type CanvasAssignmentRow,
  type CanvasCalendarEventRow,
  type CanvasClient,
} from "@personal-os/canvas-providers";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { env } from "../env.js";
import { errorToken, log } from "../logger.js";
import {
  archiveMissingCanvasAnnouncements,
  archiveMissingCanvasAssignments,
  archiveMissingCanvasCourses,
  archiveMissingCanvasEvents,
  upsertCanvasAnnouncements,
  upsertCanvasAssignments,
  upsertCanvasCalendarEvents,
  upsertCanvasCourse,
} from "./persist.js";
import { closeCanvasSyncRun, openCanvasSyncRun, type CanvasSyncRunKind } from "./run.js";

// The Canvas sync pass (ADR-068).
//
// ===========================================================================
// THIS IS A TEMPLATE REUSE OF apps/worker/src/mail/orchestrate.ts, NOT A NEW
// DESIGN. Read that file's own header first; every deviation below is called
// out explicitly rather than left to be discovered by diffing.
// ===========================================================================
//
// WHAT IS DIFFERENT FROM MAIL, AND WHY:
//
//   1. NO CURSOR. Every pass re-lists every active course from scratch
//      (ADR-068 §4: per-course polling, not an incremental feed) rather than
//      walking a delta from a stored position. There is therefore no cursor
//      race to guard against and no cursor to advance or roll back.
//   2. NO ADVISORY LOCK. See `runCanvasConnectionSync`'s own doc comment for
//      the reasoning -- a deliberate, documented choice, not an omission.
//   3. PER-COURSE CONTAINMENT, TWO LEVELS DEEP. One malformed COURSE record
//      is a translation rejection (like a malformed mail message: logged,
//      skipped, the rest of the pass continues). One course whose CHILD
//      fetch (assignments/announcements/events) throws is a "course_failed"
//      containment boundary of its own (ADR-068 §5): that course's children
//      are left untouched -- neither upserted nor archived -- and the pass
//      moves on to the next course. A single provider hiccup on one class
//      must never abort the whole institution's sync.
//   4. NO EGRESS BEYOND THIS PACKAGE'S OWN SIX TABLES. No AI, no
//      notification, no alert. ADR-068 §6 is explicit that this checkpoint
//      adds none. Checkpoint 10.2 keeps that: a dead PAT flips the row to
//      `invalid_token` (see `markConnectionInvalidToken`) but, unlike mail's
//      `needs_reauth`, enqueues no alert -- the Settings screen's own
//      status rendering is the surface, and an alert producer would need
//      its own occurrence-scoped dedupe key under ADR-058 first.

export interface CanvasSyncJobData {
  connectionId: string;
  kind: CanvasSyncRunKind;
}

export interface CanvasSyncDeps {
  db: Db;
  client: CanvasClient;
  /** Unused today -- reserved the same way `MailSyncDeps.boss` was in 7.3, in
   *  case a future checkpoint adds an alert producer here. */
  boss?: PgBoss | null;
  now?: () => Date;
}

export interface CanvasPassResult {
  skipped: string | null;
  runWritten: boolean;
  /** Courses successfully translated and upserted this pass. */
  coursesSeen: number;
  /** Courses whose child fetch (assignments/announcements/events) threw. */
  coursesFailed: number;
  coursesArchived: number;
  assignmentsSynced: number;
  announcementsSynced: number;
  eventsSynced: number;
  assignmentsArchived: number;
  announcementsArchived: number;
  eventsArchived: number;
  /** Set only when the WHOLE pass failed -- the course list itself could not
   *  be fetched. A per-course failure increments `coursesFailed` instead. */
  failureClass: string | null;
}

const EMPTY_RESULT: CanvasPassResult = {
  skipped: null,
  runWritten: false,
  coursesSeen: 0,
  coursesFailed: 0,
  coursesArchived: 0,
  assignmentsSynced: 0,
  announcementsSynced: 0,
  eventsSynced: 0,
  assignmentsArchived: 0,
  announcementsArchived: 0,
  eventsArchived: 0,
  failureClass: null,
};

function encryptedFromConnection(
  connection: typeof canvasConnections.$inferSelect,
): EncryptedSecret {
  // The three token columns are nullable (cleared on disconnect, see the
  // schema's own file header and canvas_connections_access_token_triple) but
  // this function is only ever called after the caller has already checked
  // `status === "active"`, and the DB's triple CHECK constraint guarantees
  // an active row always has all three populated -- so a null here means
  // that invariant broke, not a normal disconnected-row case this call site
  // should silently tolerate. Fail loudly rather than pass a null into
  // decryptSecret and get a confusing native crypto error instead.
  const { accessTokenCiphertext, accessTokenIv, accessTokenAuthTag } = connection;
  if (!accessTokenCiphertext || !accessTokenIv || !accessTokenAuthTag) {
    throw new Error(
      `canvas connection ${connection.id} has status "${connection.status}" but a null credential column`,
    );
  }
  return {
    ciphertext: accessTokenCiphertext,
    iv: accessTokenIv,
    authTag: accessTokenAuthTag,
  };
}

/** Records a non-fatal sync failure without changing the connection's status.
 *  Mirrors `recordMailConnectionError` (apps/worker/src/mail/token.ts). */
async function recordConnectionError(
  db: Db,
  connectionId: string,
  failureClass: string,
  now: Date,
): Promise<void> {
  await db
    .update(canvasConnections)
    .set({ lastSyncError: failureClass, lastSyncErrorAt: now, updatedAt: now })
    .where(eq(canvasConnections.id, connectionId));
}

/**
 * Marks a connection `invalid_token` because Canvas rejected the PAT itself
 * (Checkpoint 10.2, closing the 10.1C "recorded, not fixed" debt).
 *
 * Mirrors `markMailConnectionNeedsReauth` (apps/worker/src/mail/token.ts)
 * in shape and in its one load-bearing predicate: CONDITIONAL ON
 * `status = 'active'`, never on "not already invalid_token". The latter
 * would also match a row a concurrent disconnect just set to `disconnected`
 * and flip it back, resurrecting a connection the owner removed -- and a
 * disconnected row has no credential to invalidate anyway
 * (`canvas_connections_access_token_triple`). A retry of a job that already
 * transitioned matches zero rows, so `last_sync_error_at` is not re-stamped.
 *
 * THE CREDENTIAL COLUMNS ARE NOT TOUCHED. Nulling them is `disconnect`'s job
 * (apps/api/src/services/canvas-connection.ts), and it is deliberately not
 * done here: `invalid_token` is a status the owner recovers from by pasting a
 * fresh PAT through the 10.1C reconnect path, which reactivates any
 * NON-active row in place -- `id`, `created_at` and every FK-linked course/
 * assignment row preserved -- without requiring a manual disconnect first.
 * The stale ciphertext sits unused until then: the cron enqueuer selects
 * `status = 'active'` only, the API's manual-sync route refuses a non-active
 * row with `409 connection_not_active`, and `runCanvasConnectionSync`'s own
 * re-read skips one with the same reason.
 */
async function markConnectionInvalidToken(
  db: Db,
  connectionId: string,
  failureClass: string,
  now: Date,
): Promise<void> {
  await db
    .update(canvasConnections)
    .set({
      status: "invalid_token",
      lastSyncError: failureClass,
      lastSyncErrorAt: now,
      updatedAt: now,
    })
    .where(and(eq(canvasConnections.id, connectionId), eq(canvasConnections.status, "active")));
}

async function clearConnectionError(db: Db, connectionId: string, now: Date): Promise<void> {
  await db
    .update(canvasConnections)
    .set({ lastSyncAt: now, lastSyncError: null, lastSyncErrorAt: null, updatedAt: now })
    .where(eq(canvasConnections.id, connectionId));
}

/**
 * Runs one Canvas connection sync pass: every active course, and for each,
 * assignments, announcements and calendar events.
 *
 * ===========================================================================
 * NO ADVISORY LOCK, UNLIKE MAIL AND HEALTH -- A DELIBERATE CHOICE.
 * ===========================================================================
 *
 * `withMailConnectionLock`/`withHealthConnectionLock` exist because a second
 * concurrent pass corrupts SHARED, MUTABLE, ORDER-SENSITIVE state: two passes
 * reading the same `historyId` (or the same trailing window) can each write
 * back a cursor, and the STALE one landing last silently erases the other's
 * forward progress. Canvas sync carries no such state. Every pass re-lists
 * every active course from provider truth; persistence is hash-gated
 * idempotent upsert (see ./persist.ts); and archival-by-absence only fires
 * per course, and only for a course whose OWN fetch succeeded in THIS same
 * pass. Two concurrent passes for one connection would duplicate work -- read
 * the same courses twice, upsert the same rows twice -- never corrupt it: the
 * hash gate makes a redundant write a no-op, and archival's "seen this pass"
 * set is pass-local, so one pass's archival decision cannot race the other's.
 *
 * pg-boss's `policy: "stately"` plus `singletonKey: connectionId` (see
 * ../queue-names.ts) already bounds concurrent execution to at most one
 * `active` job per connection -- the same first line of defence mail/health
 * rely on before their lock is ever reached. If a second worker process is
 * ever introduced for this queue, this is the first place to revisit.
 */
export async function runCanvasConnectionSync(
  deps: CanvasSyncDeps,
  data: CanvasSyncJobData,
): Promise<CanvasPassResult> {
  const now = deps.now ? deps.now() : new Date();

  // Re-read INSIDE the handler rather than trusting the enqueue-time
  // payload: between enqueue and execution the owner may have disconnected
  // the institution, or a manual trigger may race a cron tick that already
  // disconnected it. Mirrors mail's `runLockedPass` re-select verbatim.
  const [connection] = await deps.db
    .select()
    .from(canvasConnections)
    .where(eq(canvasConnections.id, data.connectionId))
    .limit(1);

  if (!connection) {
    log.info("canvas.sync.skipped", {
      connectionId: data.connectionId,
      reason: "connection_not_found",
    });
    return { ...EMPTY_RESULT, skipped: "connection_not_found" };
  }
  if (connection.status !== "active") {
    // NO RUN ROW IS WRITTEN HERE, deliberately -- mirroring mail's
    // lock-not-acquired case: the connection isn't ours to sync right now,
    // so the honest record is no record.
    log.info("canvas.sync.skipped", {
      connectionId: connection.id,
      reason: "connection_not_active",
      status: connection.status,
    });
    return { ...EMPTY_RESULT, skipped: "connection_not_active" };
  }

  const token = decryptSecret(encryptedFromConnection(connection), env.CREDENTIALS_ENCRYPTION_KEY);
  const baseUrl = connection.canvasBaseUrl;

  const runId = await openCanvasSyncRun(deps.db, {
    connectionId: connection.id,
    kind: data.kind,
    startedAt: now,
  });
  log.info("canvas.sync.started", { connectionId: connection.id, kind: data.kind });

  let rawCourses;
  try {
    rawCourses = await deps.client.listActiveCourses(baseUrl, token);
  } catch (err) {
    const fault = classifyCanvasFault(err);
    await closeCanvasSyncRun(deps.db, runId, {
      status: "failed",
      failureClass: fault.failureClass,
      errorMessage: fault.failureClass,
      finishedAt: now,
    });
    // CONNECTION-LEVEL `auth_failed` -- Canvas rejected the PAT on the one
    // request that carries no course id -- is the token itself being dead
    // (a 401, or a non-rate-limit 403 on the account's own course list), and
    // no cron tick will change that. It flips the row to `invalid_token` so
    // the owner sees it and can reconnect. Every OTHER class (rate limit,
    // 5xx, network) is transient and only records `last_sync_error`, exactly
    // as before. A PER-COURSE `auth_failed` (a 403 on one course the token
    // lacks access to) is contained by the course loop below and never
    // reaches this branch, so one unenrolled course cannot invalidate the
    // whole connection.
    if (fault.failureClass === "auth_failed") {
      await markConnectionInvalidToken(deps.db, connection.id, fault.failureClass, now);
      log.warn("canvas.sync.connection_invalidated", {
        connectionId: connection.id,
        failureClass: fault.failureClass,
      });
    } else {
      await recordConnectionError(deps.db, connection.id, fault.failureClass, now);
    }
    log.warn("canvas.sync.failed", {
      connectionId: connection.id,
      failureClass: fault.failureClass,
      error: errorToken(err),
    });
    return { ...EMPTY_RESULT, runWritten: true, failureClass: fault.failureClass };
  }

  const result: CanvasPassResult = { ...EMPTY_RESULT, runWritten: true };
  const seenCourseIds: number[] = [];

  for (const rawCourse of rawCourses) {
    const translatedCourse = translateCanvasCourse(rawCourse);
    if (!translatedCourse.ok) {
      // A malformed COURSE record -- the mail message_rejected precedent: log,
      // skip, keep going. It carries no canvas_course_id, so it cannot enter
      // the seen set and cannot protect a stored course from archival; that
      // is an accepted, narrow consequence of a genuinely malformed record.
      log.warn("canvas.sync.course_rejected", {
        connectionId: connection.id,
        keyPath: translatedCourse.rejection.keyPath,
        received: translatedCourse.rejection.received,
      });
      continue;
    }

    const canvasCourseId = Number(translatedCourse.row.externalId);
    const courseUpsert = await upsertCanvasCourse(deps.db, {
      connectionId: connection.id,
      row: translatedCourse.row,
    });
    seenCourseIds.push(canvasCourseId);
    result.coursesSeen += 1;

    // ONE COURSE'S CHILD FETCH IS ONE CONTAINMENT BOUNDARY (ADR-068 §5).
    // Sequential, never Promise.all: bursting three concurrent requests per
    // course would multiply the request rate against Canvas's per-account
    // limit for no benefit this checkpoint needs (ADR-068 §4 -- a full
    // per-course sweep is already comfortably within the observed budget at
    // serial pace).
    let rawAssignments;
    let rawAnnouncements;
    let rawEvents;
    try {
      rawAssignments = await deps.client.listAssignments(baseUrl, token, canvasCourseId);
      rawAnnouncements = await deps.client.listAnnouncements(baseUrl, token, canvasCourseId);
      rawEvents = await deps.client.listCalendarEvents(baseUrl, token, canvasCourseId);
    } catch (err) {
      const fault = classifyCanvasFault(err);
      result.coursesFailed += 1;
      log.warn("canvas.sync.course_failed", {
        connectionId: connection.id,
        canvasCourseId,
        failureClass: fault.failureClass,
        error: errorToken(err),
      });
      // This course's children are left entirely untouched -- not upserted,
      // not archived -- and the pass moves on. An authoritative archival pass
      // over this course's assignments/announcements/events happens only on
      // a round whose fetch actually succeeded.
      continue;
    }

    const assignmentRows: CanvasAssignmentRow[] = [];
    const seenAssignmentIds: number[] = [];
    for (const raw of rawAssignments) {
      const translated = translateCanvasAssignment(raw, canvasCourseId);
      if (!translated.ok) {
        log.warn("canvas.sync.assignment_rejected", {
          connectionId: connection.id,
          canvasCourseId,
          keyPath: translated.rejection.keyPath,
          received: translated.rejection.received,
        });
        continue;
      }
      assignmentRows.push(translated.row);
      seenAssignmentIds.push(Number(translated.row.externalId));
    }
    await upsertCanvasAssignments(deps.db, {
      connectionId: connection.id,
      courseId: courseUpsert.id,
      rows: assignmentRows,
    });
    result.assignmentsSynced += assignmentRows.length;
    result.assignmentsArchived += await archiveMissingCanvasAssignments(deps.db, {
      connectionId: connection.id,
      courseId: courseUpsert.id,
      seenCanvasAssignmentIds: seenAssignmentIds,
      now,
    });

    const announcementRows: CanvasAnnouncementRow[] = [];
    const seenAnnouncementIds: number[] = [];
    for (const raw of rawAnnouncements) {
      const translated = translateCanvasAnnouncement(raw, canvasCourseId);
      if (!translated.ok) {
        log.warn("canvas.sync.announcement_rejected", {
          connectionId: connection.id,
          canvasCourseId,
          keyPath: translated.rejection.keyPath,
          received: translated.rejection.received,
        });
        continue;
      }
      announcementRows.push(translated.row);
      seenAnnouncementIds.push(Number(translated.row.externalId));
    }
    await upsertCanvasAnnouncements(deps.db, {
      connectionId: connection.id,
      courseId: courseUpsert.id,
      rows: announcementRows,
    });
    result.announcementsSynced += announcementRows.length;
    result.announcementsArchived += await archiveMissingCanvasAnnouncements(deps.db, {
      connectionId: connection.id,
      courseId: courseUpsert.id,
      seenCanvasAnnouncementIds: seenAnnouncementIds,
      now,
    });

    const eventRows: CanvasCalendarEventRow[] = [];
    const seenEventIds: number[] = [];
    for (const raw of rawEvents) {
      const translated = translateCanvasCalendarEvent(raw, canvasCourseId);
      if (!translated.ok) {
        log.warn("canvas.sync.event_rejected", {
          connectionId: connection.id,
          canvasCourseId,
          keyPath: translated.rejection.keyPath,
          received: translated.rejection.received,
        });
        continue;
      }
      eventRows.push(translated.row);
      seenEventIds.push(Number(translated.row.externalId));
    }
    await upsertCanvasCalendarEvents(deps.db, {
      connectionId: connection.id,
      courseId: courseUpsert.id,
      rows: eventRows,
    });
    result.eventsSynced += eventRows.length;
    result.eventsArchived += await archiveMissingCanvasEvents(deps.db, {
      connectionId: connection.id,
      courseId: courseUpsert.id,
      seenCanvasEventIds: seenEventIds,
      now,
    });
  }

  // Connection-level course archival. Reached only when `listActiveCourses`
  // itself succeeded, so the full course list this pass saw IS authoritative
  // for the whole connection -- unlike the per-course child archival above,
  // which is additionally gated on that one course's own fetch succeeding.
  result.coursesArchived = await archiveMissingCanvasCourses(deps.db, {
    connectionId: connection.id,
    seenCanvasCourseIds: seenCourseIds,
    now,
  });

  await closeCanvasSyncRun(deps.db, runId, {
    status: "succeeded",
    coursesSynced: result.coursesSeen,
    assignmentsSynced: result.assignmentsSynced,
    announcementsSynced: result.announcementsSynced,
    eventsSynced: result.eventsSynced,
    finishedAt: now,
  });
  await clearConnectionError(deps.db, connection.id, now);

  log.info("canvas.sync.finished", {
    connectionId: connection.id,
    coursesSeen: result.coursesSeen,
    coursesFailed: result.coursesFailed,
    coursesArchived: result.coursesArchived,
    assignmentsSynced: result.assignmentsSynced,
    announcementsSynced: result.announcementsSynced,
    eventsSynced: result.eventsSynced,
  });

  return result;
}

/**
 * Fans out one sync job per ACTIVE Canvas connection.
 *
 * Mirrors `enqueueMailSyncForAllActiveConnections` exactly: `singletonKey` is
 * the connection id, matching the queue's `stately` policy, so a tick landing
 * while a pass is still running adds nothing rather than queueing a
 * duplicate.
 */
export async function enqueueCanvasSyncForAllActiveConnections(
  db: Db,
  boss: PgBoss,
  queue: string,
): Promise<number> {
  const rows = await db
    .select({ id: canvasConnections.id })
    .from(canvasConnections)
    .where(eq(canvasConnections.status, "active"));

  for (const row of rows) {
    await boss.send(queue, { connectionId: row.id, kind: "cron" }, { singletonKey: row.id });
  }
  return rows.length;
}
