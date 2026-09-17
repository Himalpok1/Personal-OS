// The at-a-glance row above the Settings integration cards (Checkpoint 10.6):
// one chip per integration -- Calendar, Gmail, Health, Canvas -- so the owner
// reads every connection state without scrolling four cards.
//
// Pure, so the mapping is pinned by a test rather than spread through JSX.
// Each chip reuses the SAME state module and the SAME tone function its card
// already uses (status-tone.ts), so the row can never disagree with the card
// below it: the row is a projection of the cards, not a fifth opinion.
//
// Calendar has no display-state module of its own (its cards read the wire
// status directly), so the overall calendar state is folded here, following
// the "worst mailbox wins" precedence resolveOverallMailState applies.
import type { CalendarConnection } from "@personal-os/schema";
import type { CanvasConnectionDisplayState } from "@/components/canvas/connection-state";
import type { HealthConnectionDisplayState } from "@/components/health/connection-state";
import type { MailConnectionDisplayState } from "@/components/mail/connection-state";
import type { ChipTone } from "@/components/ui";
import {
  canvasConnectionChipTone,
  healthConnectionChipTone,
  mailConnectionChipTone,
} from "./status-tone";

export type CalendarOverallState =
  | "unavailable" // Personal OS's own API could not be reached
  | "not_connected" // no calendar connection exists
  | "needs_reconnect" // needs_reauth or revoked
  | "disconnected" // every connection is disconnected
  | "connected";

/**
 * Worst connection wins, in this order: unavailable, needs_reconnect,
 * disconnected, connected -- the same "a card that says Connected while one
 * of its rows is broken" rule the mail and Canvas overall states apply.
 */
export function resolveOverallCalendarState(input: {
  connections: readonly Pick<CalendarConnection, "status">[];
  isLoadError: boolean;
}): CalendarOverallState {
  if (input.isLoadError) return "unavailable";
  if (input.connections.length === 0) return "not_connected";
  const statuses = new Set(input.connections.map((connection) => connection.status));
  if (statuses.has("needs_reauth") || statuses.has("revoked")) return "needs_reconnect";
  if (statuses.has("active")) return "connected";
  return "disconnected";
}

export function calendarOverallChipTone(state: CalendarOverallState): ChipTone {
  switch (state) {
    case "unavailable":
      return "danger";
    case "needs_reconnect":
      return "warning";
    case "connected":
      return "success";
    case "not_connected":
    case "disconnected":
      return "neutral";
  }
}

export type IntegrationKey = "calendar" | "mail" | "health" | "canvas";

export interface IntegrationSummaryItem {
  key: IntegrationKey;
  /** The chip's leading word: "Calendar", "Gmail", "Health", "Canvas". */
  label: string;
  /** The state word after it, or null while that integration's first load is in flight. */
  state: string | null;
  tone: ChipTone;
}

export interface IntegrationSummaryInput {
  /** null while the first load is in flight. */
  calendar: CalendarOverallState | null;
  mail: MailConnectionDisplayState | null;
  health: HealthConnectionDisplayState | null;
  canvas: CanvasConnectionDisplayState | null;
}

/** `needs_reconnect` -> "needs reconnect", the convention every card chip already uses. */
function stateWords(state: string): string {
  return state.replace(/_/g, " ");
}

export function summarizeIntegrations(input: IntegrationSummaryInput): IntegrationSummaryItem[] {
  return [
    {
      key: "calendar",
      label: "Calendar",
      state: input.calendar === null ? null : stateWords(input.calendar),
      tone: input.calendar === null ? "neutral" : calendarOverallChipTone(input.calendar),
    },
    {
      key: "mail",
      label: "Gmail",
      state: input.mail === null ? null : stateWords(input.mail),
      tone: input.mail === null ? "neutral" : mailConnectionChipTone(input.mail),
    },
    {
      key: "health",
      label: "Health",
      state: input.health === null ? null : stateWords(input.health),
      tone: input.health === null ? "neutral" : healthConnectionChipTone(input.health),
    },
    {
      key: "canvas",
      label: "Canvas",
      state: input.canvas === null ? null : stateWords(input.canvas),
      tone: input.canvas === null ? "neutral" : canvasConnectionChipTone(input.canvas),
    },
  ];
}

/** "Calendar · connected" -- the chip's text and its spoken label alike. */
export function integrationChipLabel(item: IntegrationSummaryItem): string {
  return item.state === null ? item.label : `${item.label} · ${item.state}`;
}
