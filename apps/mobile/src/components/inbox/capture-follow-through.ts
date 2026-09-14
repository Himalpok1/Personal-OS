import { readStoredParseResult, type InboxItem } from "@personal-os/schema";
import { entityRoute, type EntityRoute } from "./entity-route";

// Checkpoint 9.3 "D3-lite": after Quick Capture sends a capture, tell the
// owner what it BECAME. `POST /capture` returns 202 with an inbox id and the
// worker files it asynchronously, so until now the composer closed and the
// only evidence anything happened was a new row on the Inbox tab.
//
// Bounded by construction: at most FOLLOW_THROUGH_MAX_POLLS reads of
// GET /inbox/:id, spread over at most FOLLOW_THROUGH_MAX_WINDOW_MS. A capture
// that is still `pending` after that shows nothing further -- it is on the
// Inbox tab, and polling forever from a component mounted over every screen
// is exactly the pattern quick-add-fab.tsx's outbox badge already had to
// abandon on the Rabbit R1.
//
// Pure: no timers, no fetch, no React. The driver takes both as parameters so
// the whole schedule is testable with injected functions.

/**
 * Delay BEFORE each poll, in order. Six entries summing to 30,000 ms: the
 * parser typically answers in a few seconds, so the early polls are close
 * together and the later ones spread out.
 */
export const FOLLOW_THROUGH_POLL_DELAYS_MS: readonly number[] = [
  2_000, 3_000, 5_000, 5_000, 7_000, 8_000,
];
export const FOLLOW_THROUGH_MAX_POLLS = FOLLOW_THROUGH_POLL_DELAYS_MS.length;
export const FOLLOW_THROUGH_MAX_WINDOW_MS = FOLLOW_THROUGH_POLL_DELAYS_MS.reduce(
  (sum, delay) => sum + delay,
  0,
);

/** How long a settled result stays on screen before clearing itself. */
export const FOLLOW_THROUGH_RESULT_VISIBLE_MS = 8_000;

/** Bound on the entity title shown in the banner. */
export const FOLLOW_THROUGH_TITLE_MAX_CHARS = 80;

export type FollowThroughOutcome =
  | {
      kind: "filed";
      entityType: NonNullable<InboxItem["entity_type"]>;
      route: EntityRoute;
      /** The parser's title for the entity, control-stripped and bounded; null if unreadable. */
      title: string | null;
    }
  | { kind: "needs_confirm"; inboxId: string }
  | { kind: "failed"; inboxId: string }
  /** Still pending after the bound, or settled in a shape with nowhere to go. */
  | { kind: "unresolved" };

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

function boundedTitle(raw: string): string | null {
  const oneLine = raw.replace(CONTROL_CHARACTERS, "").replace(/\s+/g, " ").trim();
  if (oneLine.length === 0) return null;
  if (oneLine.length <= FOLLOW_THROUGH_TITLE_MAX_CHARS) return oneLine;
  return `${oneLine.slice(0, FOLLOW_THROUGH_TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

/** The title the worker committed, read from the stored tool call. */
export function committedTitle(item: Pick<InboxItem, "parse_result">): string | null {
  const stored = readStoredParseResult(item.parse_result);
  if (stored === null || stored.toolCall.tool === "unclear") return null;
  return boundedTitle(stored.toolCall.args.title);
}

/**
 * What a fetched item means for the banner. `null` means "not settled yet,
 * keep polling"; anything else ends the poll.
 */
export function classifyFollowThrough(item: InboxItem): FollowThroughOutcome | null {
  switch (item.status) {
    case "pending":
      return null;
    case "needs_confirm":
      return { kind: "needs_confirm", inboxId: item.id };
    case "failed":
      return { kind: "failed", inboxId: item.id };
    case "parsed":
    case "confirmed": {
      const route = entityRoute(item);
      // `parsed`/`confirmed` with no entity yet is the window between the
      // status write and the commit; the next poll will see the id.
      if (route === null || item.entity_type === null) return null;
      return { kind: "filed", entityType: item.entity_type, route, title: committedTitle(item) };
    }
  }
}

export interface FollowThroughDeps {
  fetchItem: (inboxId: string) => Promise<InboxItem>;
  sleep: (ms: number) => Promise<void>;
  /** Checked before every poll; a cancelled run resolves `unresolved` without fetching. */
  isCancelled?: () => boolean;
}

/**
 * Polls until the capture settles or the bound is spent. A poll that throws
 * (network blip, the API restarting) is counted and skipped rather than
 * ending the run -- the next scheduled poll may succeed.
 */
export async function followCaptureThrough(
  inboxId: string,
  deps: FollowThroughDeps,
): Promise<FollowThroughOutcome> {
  const cancelled = deps.isCancelled ?? (() => false);
  for (const delay of FOLLOW_THROUGH_POLL_DELAYS_MS) {
    await deps.sleep(delay);
    if (cancelled()) return { kind: "unresolved" };
    let item: InboxItem;
    try {
      item = await deps.fetchItem(inboxId);
    } catch {
      continue;
    }
    if (cancelled()) return { kind: "unresolved" };
    const outcome = classifyFollowThrough(item);
    if (outcome !== null) return outcome;
  }
  return { kind: "unresolved" };
}

/** Banner copy. `null` for an outcome that shows nothing. */
export function followThroughLabel(outcome: FollowThroughOutcome): string | null {
  switch (outcome.kind) {
    case "filed":
      return outcome.title === null
        ? `Filed as ${outcome.entityType}`
        : `Filed as ${outcome.entityType}: ${outcome.title}`;
    case "needs_confirm":
      return "Needs confirmation";
    case "failed":
      return "Couldn't file this capture";
    case "unresolved":
      return null;
  }
}

/** Where a tap on the banner goes. */
export function followThroughRoute(
  outcome: FollowThroughOutcome,
): EntityRoute | `/inbox/${string}` | null {
  switch (outcome.kind) {
    case "filed":
      return outcome.route;
    case "needs_confirm":
    case "failed":
      return `/inbox/${outcome.inboxId}`;
    case "unresolved":
      return null;
  }
}
