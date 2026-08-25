// Render-level tests for the Health components.
//
// This app ships NO render library -- no @testing-library/react-native, no
// react-test-renderer (confirmed in apps/mobile/package.json). The
// established technique, from brief/brief-card.test.tsx and
// __tests__/events-screen.test.tsx, is to call the component function
// directly and walk the plain React element tree it returns. This file copies
// that technique verbatim, including the `deepRender` step that expands
// app-defined function components (ActionButton, LabelledValue,
// ChartDataSummary) while leaving react-native's own View/Text/Pressable as
// leaves, identified by reference equality against the same aliased
// "react-native" import the components use (vitest.config.mts aliases
// react-native -> react-native-web).
//
// Every component here except HealthTodayCard is a pure, hookless function of
// its props, so a direct call is safe. HealthTodayCard calls useHealthSummary
// and useRouter; the first is mocked below and the second resolves to
// src/__mocks__/expo-router.ts, whose useRouter is a plain function with no
// dispatcher underneath.
//
// The invariants these tests exist to protect are all one invariant wearing
// different clothes: A MISSING HEALTH VALUE MUST NEVER RENDER AS A NUMBER.
// Twelve of the eighteen enabled streams on the development account have
// never produced a value (Checkpoint 6.3L), so "missing" is this surface's
// common case, and every one of the assertions below would pass vacuously if
// it only checked that the right words appear -- so they also check that no
// digit appears.

import type {
  HealthConnectionSummary,
  HealthFreshnessDetail,
  HealthMetricCapability,
  HealthMetricPoint,
  HealthMetricTile,
  HealthSleepSession,
  HealthSummaryResponse,
  HealthWorkoutSession,
} from "@personal-os/schema";
import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHealthSummary } from "@/queries/health";
import { HealthChart, describeSeries } from "./health-chart";
import { HealthConnectionCard, scopeLabel } from "./connection-card";
import { HealthTodayCard } from "./health-today-card";
import { METRIC_EXPLANATIONS } from "./metric-state";
import { MetricTile } from "./metric-tile";
import {
  SLEEP_STAGE_NOTE,
  SleepSessionRow,
  SleepSummaryCard,
  WORKOUT_DETAIL_NOTE,
  WorkoutSessionRow,
} from "./session-cards";
import type { HealthConnectionDisplayState } from "./connection-state";

vi.mock("@/queries/health", () => ({ useHealthSummary: vi.fn() }));

// ---------------------------------------------------------------------------
// Tree-walking helpers (technique from brief/brief-card.test.tsx)
// ---------------------------------------------------------------------------

const HOST_TYPES = new Set<unknown>([View, Text, Pressable]);

function deepRender(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepRender);
  if (node === null || typeof node !== "object") return node;

  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!("type" in el)) return node;

  if (typeof el.type === "function" && !HOST_TYPES.has(el.type)) {
    const rendered = (el.type as (props: unknown) => unknown)(el.props ?? {});
    return deepRender(rendered);
  }

  if (el.props && "children" in el.props) {
    return { ...el, props: { ...el.props, children: deepRender(el.props.children) } };
  }

  return el;
}

interface WalkedElement {
  type?: unknown;
  key?: string | null;
  props?: Record<string, unknown> & { children?: unknown };
}

function findAll(
  node: unknown,
  predicate: (n: WalkedElement) => boolean,
  acc: WalkedElement[] = [],
): WalkedElement[] {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, acc);
    return acc;
  }
  if (typeof node !== "object") return acc;
  const el = node as WalkedElement;
  if (predicate(el)) acc.push(el);
  const children = el.props?.children;
  if (children !== undefined) {
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) findAll(child, predicate, acc);
  }
  return acc;
}

function getTextContent(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  const el = node as WalkedElement;
  if (el.props?.children !== undefined) return getTextContent(el.props.children);
  return "";
}

function findButtons(node: unknown): WalkedElement[] {
  return findAll(node, (n) => n.type === Pressable);
}

/** Elements whose React key starts with the given prefix. The chart's keys are
 *  chosen partly so these tests can name what they are asserting about. */
function findByKeyPrefix(node: unknown, prefix: string): WalkedElement[] {
  return findAll(node, (n) => typeof n.key === "string" && n.key.startsWith(prefix));
}

function styleOf(el: WalkedElement): Record<string, unknown> {
  return (el.props?.style ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Fixtures -- every value invented. No real health data appears in this repo.
// ---------------------------------------------------------------------------

const TODAY = "2026-08-25";

function point(overrides: Partial<HealthMetricPoint> = {}): HealthMetricPoint {
  return {
    local_date: TODAY,
    state: "unknown",
    value: null,
    source_count: null,
    ...overrides,
  };
}

function tile(overrides: Partial<HealthMetricTile> = {}): HealthMetricTile {
  return {
    metric: "steps",
    unit: "count",
    aggregation: "sum",
    point: point(),
    ...overrides,
  };
}

function capability(overrides: Partial<HealthMetricCapability> = {}): HealthMetricCapability {
  return {
    metric: "steps",
    unit: "count",
    aggregation: "sum",
    sync_enabled: true,
    capability_status: "available_in_window",
    capability_checked_at: "2026-08-25T04:00:00.000Z",
    verified_through_date: "2026-08-24",
    earliest_verified_date: "2026-07-01",
    first_data_date: "2026-07-01",
    last_successful_sync_at: "2026-08-25T04:00:00.000Z",
    backfill_status: "idle",
    ...overrides,
  };
}

function freshness(overrides: Partial<HealthFreshnessDetail> = {}): HealthFreshnessDetail {
  return {
    last_successful_sync_at: "2026-08-25T04:00:00.000Z",
    last_attempted_sync_at: "2026-08-25T04:00:00.000Z",
    last_attempt_status: "succeeded",
    verified_through_date: "2026-08-24",
    days_behind: 1,
    is_stale: false,
    staleness_threshold_days: 35,
    sync_in_progress: false,
    ...overrides,
  };
}

function connection(overrides: Partial<HealthConnectionSummary> = {}): HealthConnectionSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    provider: "google_health",
    status: "active",
    identity_verified_at: "2026-08-20T00:00:00.000Z",
    granted_scopes: ["https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly"],
    missing_scopes: [],
    has_partial_scope: false,
    needs_reconnect: false,
    has_sync_error: false,
    last_sync_error_at: null,
    ...overrides,
  };
}

function sleepSession(overrides: Partial<HealthSleepSession> = {}): HealthSleepSession {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    wake_local_date: "2026-08-25",
    // 22:41 -> 06:12 in a UTC-05:00 zone, expressed as instants plus their
    // own stored offsets, which is how the row actually arrives.
    start_at: "2026-08-25T03:41:00.000Z",
    end_at: "2026-08-25T11:12:00.000Z",
    start_utc_offset_seconds: -5 * 3600,
    end_utc_offset_seconds: -5 * 3600,
    duration_seconds: 27_060,
    session_type: null,
    session_subtype: null,
    source: { recording_method: null, device_form_factor: null, application_platform: null },
    stages: null,
    asleep_seconds: null,
    awake_seconds: null,
    ...overrides,
  };
}

function workoutSession(overrides: Partial<HealthWorkoutSession> = {}): HealthWorkoutSession {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    start_local_date: "2026-08-24",
    start_at: "2026-08-24T17:05:00.000Z",
    end_at: "2026-08-24T17:50:00.000Z",
    start_utc_offset_seconds: -5 * 3600,
    end_utc_offset_seconds: -5 * 3600,
    duration_seconds: 2700,
    session_type: "SESSION_TYPE_RUNNING",
    session_subtype: null,
    source: { recording_method: null, device_form_factor: null, application_platform: null },
    distance_meters: null,
    calories_kcal: null,
    heart_rate_zones: null,
    ...overrides,
  };
}

function summary(overrides: Partial<HealthSummaryResponse> = {}): HealthSummaryResponse {
  return {
    configured: true,
    connection: connection(),
    timezone: "America/Chicago",
    local_date: TODAY,
    freshness: freshness(),
    today: [],
    latest: [],
    latest_sleep: null,
    sleep_7d_average_seconds: null,
    latest_workout: null,
    capabilities: [],
    ...overrides,
  };
}

// Every missing state, paired with the inputs that produce it and the exact
// sentence metric-state.ts owns for it.
const MISSING_CASES: {
  name: string;
  tile: HealthMetricTile;
  capability: HealthMetricCapability;
  expected: string;
}[] = [
  {
    name: "sync_disabled",
    tile: tile(),
    capability: capability({ sync_enabled: false }),
    expected: METRIC_EXPLANATIONS.sync_disabled,
  },
  {
    name: "needs_scope",
    tile: tile(),
    capability: capability({ capability_status: "missing_scope" }),
    expected: METRIC_EXPLANATIONS.needs_scope,
  },
  {
    name: "unsupported",
    tile: tile(),
    capability: capability({ capability_status: "not_supported" }),
    expected: METRIC_EXPLANATIONS.unsupported,
  },
  {
    name: "provider_issue",
    tile: tile(),
    capability: capability({ capability_status: "provider_error" }),
    expected: METRIC_EXPLANATIONS.provider_issue,
  },
  {
    name: "recorded_none",
    tile: tile({ point: point({ state: "verified_absent" }) }),
    capability: capability(),
    expected: METRIC_EXPLANATIONS.recorded_none,
  },
  {
    name: "awaiting_first_data",
    tile: tile(),
    capability: capability({
      capability_status: "supported_empty_in_window",
      first_data_date: null,
    }),
    expected: METRIC_EXPLANATIONS.awaiting_first_data,
  },
  {
    name: "not_checked_today",
    tile: tile(),
    capability: capability(),
    expected: METRIC_EXPLANATIONS.not_checked_today,
  },
  {
    name: "not_checked (a past day)",
    tile: tile({ point: point({ local_date: "2026-08-20" }) }),
    capability: capability(),
    expected: METRIC_EXPLANATIONS.not_checked,
  },
];

// ---------------------------------------------------------------------------
// MetricTile
// ---------------------------------------------------------------------------

describe("<MetricTile />", () => {
  it("renders a GENUINE RECORDED ZERO as a real 0, with no missing-state sentence anywhere", () => {
    const tree = deepRender(
      MetricTile({
        tile: tile({ point: point({ state: "value", value: "0" }) }),
        capability: capability(),
        todayLocalDate: TODAY,
      }),
    );
    const text = getTextContent(tree);

    // Zero steps on a day the device was worn is data. This is the assertion
    // migration 0013's has_data CHECK (ADR-047) exists to make possible.
    expect(text).toContain("0");
    for (const sentence of Object.values(METRIC_EXPLANATIONS)) {
      expect(text).not.toContain(sentence);
    }
  });

  it.each(MISSING_CASES)(
    "$name: renders the explanatory sentence and NO digit at all",
    ({ tile: t, capability: c, expected }) => {
      const tree = deepRender(MetricTile({ tile: t, capability: c, todayLocalDate: TODAY }));
      const text = getTextContent(tree);

      expect(text).toContain(expected);
      // The load-bearing half. A tile that fell through to `value ?? 0`, or to
      // a "--" placeholder rendered next to a stale number, would still
      // contain the right sentence; only this catches it.
      expect(text).not.toMatch(/\d/);
    },
  );

  it("renders the last-recorded fallback ALONGSIDE the missing words, never instead of them", () => {
    const tree = deepRender(
      MetricTile({
        tile: tile(),
        capability: capability({
          capability_status: "supported_empty_in_window",
          first_data_date: "2026-07-01",
        }),
        todayLocalDate: TODAY,
        latest: tile({ point: point({ local_date: "2026-08-23", state: "value", value: "8140" }) }),
      }),
    );
    const text = getTextContent(tree);

    expect(text).toContain(METRIC_EXPLANATIONS.not_checked_today);
    expect(text).toContain("Last recorded 8,140");
    // The older number is never the headline: it always arrives attached to
    // the words "Last recorded" and a date, so it cannot be read as today's.
    expect(text).toMatch(/Last recorded 8,140 on /);
  });

  it("does not repeat today's own value back as a 'last recorded' line", () => {
    const same = tile({ point: point({ state: "value", value: "5000" }) });
    const tree = deepRender(
      MetricTile({
        tile: same,
        capability: capability(),
        todayLocalDate: TODAY,
        latest: same,
      }),
    );

    expect(getTextContent(tree)).not.toContain("Last recorded");
  });

  it("accessibilityLabel names the metric and the VALUE, with the date", () => {
    const tree = deepRender(
      MetricTile({
        tile: tile({ metric: "distance", unit: "millimeters" }),
        capability: capability({ metric: "distance", unit: "millimeters" }),
        todayLocalDate: TODAY,
      }),
    ) as WalkedElement;

    // Missing case first: the label carries the REASON, never a bare number.
    const label = String(tree.props?.accessibilityLabel);
    expect(label).toContain("Distance");
    expect(label).toContain(METRIC_EXPLANATIONS.not_checked_today);
  });

  it("accessibilityLabel names the metric and the reason when the value is missing", () => {
    const tree = deepRender(
      MetricTile({
        tile: tile({ point: point({ state: "value", value: "9012" }) }),
        capability: capability(),
        todayLocalDate: TODAY,
      }),
    ) as WalkedElement;

    const label = String(tree.props?.accessibilityLabel);
    expect(label).toContain("Steps");
    expect(label).toContain("9,012");
    // Colour alone must never be the carrier; the date is always spoken.
    expect(label).toMatch(/Aug 25, 2026/);
  });

  it("uses the short label in compact mode so the Rabbit's 480px row does not truncate", () => {
    const props = {
      tile: tile({ metric: "daily-heart-rate-variability", unit: "beatsPerMinute" }),
      capability: capability({ metric: "daily-heart-rate-variability" }),
      todayLocalDate: TODAY,
    };
    expect(getTextContent(deepRender(MetricTile({ ...props, compact: true })))).toContain("HRV");
    expect(getTextContent(deepRender(MetricTile(props)))).toContain("Heart rate variability");
  });

  it("is a real, accessible button when onPress is supplied and an inert View otherwise", () => {
    const withPress = deepRender(
      MetricTile({
        tile: tile(),
        capability: capability(),
        todayLocalDate: TODAY,
        onPress: () => {},
      }),
    );
    const buttons = findButtons(withPress);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.props?.accessibilityRole).toBe("button");

    const withoutPress = deepRender(
      MetricTile({ tile: tile(), capability: capability(), todayLocalDate: TODAY }),
    );
    expect(findButtons(withoutPress)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HealthConnectionCard
// ---------------------------------------------------------------------------

const ALL_STATES: HealthConnectionDisplayState[] = [
  "unavailable",
  "not_configured",
  "not_connected",
  "needs_reconnect",
  "syncing",
  "partial_scope",
  "stale",
  "error",
  "current",
];

/** States where a manual sync must be impossible -- either no control at all,
 *  or a control that is genuinely disabled. */
const SYNC_BLOCKED: HealthConnectionDisplayState[] = [
  "unavailable",
  "not_configured",
  "not_connected",
  "needs_reconnect",
  "syncing",
];

function renderConnectionCard(
  state: HealthConnectionDisplayState,
  overrides: Partial<Parameters<typeof HealthConnectionCard>[0]> = {},
): unknown {
  return deepRender(
    HealthConnectionCard({
      state,
      connection: connection(),
      freshness: freshness(),
      todayLocalDate: TODAY,
      onSync: () => {},
      onReconnect: () => {},
      ...overrides,
    }),
  );
}

function syncButton(tree: unknown): WalkedElement | undefined {
  return findButtons(tree).find((b) => getTextContent(b).startsWith("Sync"));
}

describe("<HealthConnectionCard />", () => {
  it("gives all nine states distinct copy", () => {
    const bodies = ALL_STATES.map((state) => getTextContent(renderConnectionCard(state)));
    expect(new Set(bodies).size).toBe(ALL_STATES.length);
  });

  it.each(SYNC_BLOCKED)("%s: a manual sync cannot be requested", (state) => {
    const button = syncButton(renderConnectionCard(state));
    if (button === undefined) return; // no control at all is a stronger guarantee
    expect(button.props?.disabled).toBe(true);
    expect(button.props?.accessibilityState).toEqual({ disabled: true });
  });

  it.each<HealthConnectionDisplayState>(["partial_scope", "stale", "error", "current"])(
    "%s: a manual sync IS offered and genuinely enabled",
    (state) => {
      const button = syncButton(renderConnectionCard(state));
      expect(button).toBeDefined();
      expect(button!.props?.disabled).toBe(false);
      expect(button!.props?.accessibilityState).toEqual({ disabled: false });
    },
  );

  it("isSyncPending disables the control even in an otherwise-enabled state", () => {
    const button = syncButton(renderConnectionCard("current", { isSyncPending: true }));
    expect(button).toBeDefined();
    // The prop and the a11y state, not the label -- a relabelled but still
    // pressable button is exactly what fires a second sync on a double tap.
    expect(button!.props?.disabled).toBe(true);
    expect(button!.props?.accessibilityState).toEqual({ disabled: true });
  });

  it("not_configured offers no Connect control, because there is nothing to connect to", () => {
    const tree = renderConnectionCard("not_configured");
    const labels = findButtons(tree).map(getTextContent);
    expect(labels).not.toContain("Connect");
    expect(labels).not.toContain("Reconnect");
  });

  it("not_connected offers Connect, and needs_reconnect offers Reconnect", () => {
    expect(findButtons(renderConnectionCard("not_connected")).map(getTextContent)).toContain(
      "Connect",
    );
    expect(findButtons(renderConnectionCard("needs_reconnect")).map(getTextContent)).toContain(
      "Reconnect",
    );
  });

  it("unavailable asserts nothing about the connection", () => {
    const text = getTextContent(renderConnectionCard("unavailable"));
    expect(text).toContain("can't reach its own API");
    // No claim in either direction about whether Google Health is linked.
    expect(text).not.toContain("Not connected");
    expect(text).not.toContain("Connected");
  });

  it("partial_scope names the missing data types in words, never as scope URLs", () => {
    const text = getTextContent(
      renderConnectionCard("partial_scope", {
        connection: connection({
          has_partial_scope: true,
          missing_scopes: [
            "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
            "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
          ],
        }),
      }),
    );

    expect(text).toContain("Sleep");
    expect(text).toContain("Health metrics and measurements");
    expect(text).not.toContain("googleapis.com");
    expect(text).not.toContain("readonly");
  });

  it("stale states how far behind it is and names the trailing-window constraint", () => {
    const text = getTextContent(
      renderConnectionCard("stale", {
        freshness: freshness({
          is_stale: true,
          days_behind: 41,
          verified_through_date: "2026-07-15",
        }),
      }),
    );

    expect(text).toContain("41 days behind");
    expect(text).toContain("35 days ago");
  });

  it("error never renders a provider error string -- only the consequence", () => {
    const text = getTextContent(
      renderConnectionCard("error", {
        connection: connection({
          has_sync_error: true,
          last_sync_error_at: "2026-08-25T03:00:00.000Z",
        }),
      }),
    );

    expect(text).toContain("didn't complete");
    expect(text).toContain("try again");
    // The contract cannot even express one, but assert it anyway: this is the
    // rule most likely to be broken by a future "helpful" addition.
    expect(text).not.toMatch(/INVALID_|Error:|SQLSTATE|invalid_grant/);
  });

  it("never claims anything about paired devices or a wearable's last sync", () => {
    for (const state of ALL_STATES) {
      const text = getTextContent(renderConnectionCard(state));
      expect(text).not.toMatch(/\bwearable\b|\bwatch\b|\bpaired\b/i);
    }
  });

  it("explains that Personal OS only reads what already reached Google Health", () => {
    const text = getTextContent(renderConnectionCard("current"));
    expect(text).toContain("Personal OS reads what's already in Google Health");
  });

  it("scopeLabel falls back to readable words for a scope it does not know", () => {
    expect(scopeLabel("https://www.googleapis.com/auth/googlehealth.body_temp.readonly")).toBe(
      "Body temp",
    );
  });
});

// ---------------------------------------------------------------------------
// Copy safety across every explanation this surface can produce
// ---------------------------------------------------------------------------

describe("health copy safety", () => {
  it("never describes an account that simply has no data yet as unsupported or unavailable", () => {
    const text = getTextContent(
      deepRender(
        MetricTile({
          tile: tile(),
          capability: capability({
            capability_status: "supported_empty_in_window",
            first_data_date: null,
          }),
          todayLocalDate: TODAY,
        }),
      ),
    );

    expect(text).toContain(METRIC_EXPLANATIONS.awaiting_first_data);
    for (const forbidden of ["unsupported", "unavailable", "not supported"]) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("offers no interpretation, diagnosis, or advice in any metric explanation", () => {
    for (const sentence of Object.values(METRIC_EXPLANATIONS)) {
      expect(sentence).not.toMatch(
        /\b(should|try to|recommend|healthy|unhealthy|risk|normal range|improve|goal)\b/i,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

describe("sleep and workout cards", () => {
  it("SleepSummaryCard states that stage detail is not stored, and prints no stage figure", () => {
    const text = getTextContent(
      deepRender(SleepSummaryCard({ session: sleepSession(), averageSeconds: 26_400 })),
    );

    expect(text).toContain(SLEEP_STAGE_NOTE);
    // The specific failure this guards: a stages row rendered from three null
    // fields, each formatted through formatDuration(0).
    expect(text).not.toContain("0h 0m");
    // Exactly two durations exist on this card -- the night's total and the
    // 7-day average. A third would be a stage figure conjured from a null.
    // Asserted by count rather than by searching for the words "deep"/"REM",
    // which legitimately appear inside SLEEP_STAGE_NOTE itself.
    expect(text.match(/\d+h \d+m/g)).toHaveLength(2);
  });

  it("SleepSummaryCard shows the wake date, the duration, and both clock times", () => {
    const text = getTextContent(
      deepRender(SleepSummaryCard({ session: sleepSession(), averageSeconds: 26_400 })),
    );

    expect(text).toContain("Night ending");
    expect(text).toContain("Aug 25, 2026");
    expect(text).toContain("7h 31m");
    expect(text).toContain("22:41");
    expect(text).toContain("06:12");
    expect(text).toContain("7-day average 7h 20m");
  });

  it("renders session times in the zone they were LIVED, not the viewer's zone", () => {
    // Same instants, but the row says it happened at +09:00. The rendered
    // clock must follow the stored offset, which is the whole reason both
    // offsets are persisted per session end.
    const text = getTextContent(
      deepRender(
        SleepSummaryCard({
          session: sleepSession({
            start_utc_offset_seconds: 9 * 3600,
            end_utc_offset_seconds: 9 * 3600,
          }),
          averageSeconds: null,
        }),
      ),
    );

    expect(text).toContain("12:41");
    expect(text).toContain("20:12");
    expect(text).not.toContain("22:41");
  });

  it("SleepSummaryCard is honest, not blank, when there is no session", () => {
    const text = getTextContent(deepRender(SleepSummaryCard({ session: null, averageSeconds: null })));
    expect(text).toContain("No sleep sessions have reached Google Health yet");
    expect(text).not.toMatch(/\d+h \d+m/);
  });

  it("SleepSessionRow renders one night without inventing a stage breakdown", () => {
    const text = getTextContent(deepRender(SleepSessionRow({ session: sleepSession() })));
    expect(text).toContain("7h 31m");
    expect(text).toContain("22:41 → 06:12");
  });

  it("WorkoutSessionRow omits distance, calories and heart-rate-zone rows entirely when null", () => {
    const text = getTextContent(deepRender(WorkoutSessionRow({ session: workoutSession() })));

    expect(text).toContain("SESSION_TYPE_RUNNING");
    expect(text).toContain("45m");
    // A label with nothing beside it reads as a measurement of nothing.
    expect(text).not.toMatch(/Distance|Calories|kcal|Zone/i);
    expect(text).not.toContain("km");
  });

  it("WORKOUT_DETAIL_NOTE names the gap as ours, not as a Google limitation", () => {
    expect(WORKOUT_DETAIL_NOTE).toContain("Personal OS doesn't store");
    expect(WORKOUT_DETAIL_NOTE).not.toMatch(/Google (Health )?(doesn't|does not|can't|cannot)/);
  });

  it("passes an unknown provider session type through verbatim rather than interpreting it", () => {
    const text = getTextContent(
      deepRender(
        WorkoutSessionRow({
          session: workoutSession({ session_type: "SESSION_TYPE_UNKNOWN_42", session_subtype: null }),
        }),
      ),
    );
    expect(text).toContain("SESSION_TYPE_UNKNOWN_42");
  });
});

// ---------------------------------------------------------------------------
// HealthChart
// ---------------------------------------------------------------------------

const GAPPED_SERIES: HealthMetricPoint[] = [
  point({ local_date: "2026-08-20", state: "value", value: "60" }),
  point({ local_date: "2026-08-21", state: "value", value: "64" }),
  point({ local_date: "2026-08-22", state: "unknown", value: null }),
  point({ local_date: "2026-08-23", state: "value", value: "58" }),
  point({ local_date: "2026-08-24", state: "verified_absent", value: null }),
  point({ local_date: "2026-08-25", state: "value", value: "62" }),
];

describe("<HealthChart />", () => {
  it("LINE: breaks the path at every gap instead of interpolating across it", () => {
    const tree = deepRender(
      HealthChart({
        metric: "daily-resting-heart-rate",
        points: GAPPED_SERIES,
        unit: "beatsPerMinute",
        aggregation: "average",
        kind: "line",
        width: 300,
        height: 100,
      }),
    );

    // 6 days with holes at index 2 and 4 leaves exactly one joinable pair
    // (20->21). A renderer that connected across the holes would produce 3
    // more segments and draw values nobody recorded.
    const segments = findByKeyPrefix(tree, "seg-");
    expect(segments).toHaveLength(1);
    expect(segments[0]!.key).toBe("seg-2026-08-20:2026-08-21");

    // A dot for each readable day, and none for the holes.
    expect(findByKeyPrefix(tree, "dot-")).toHaveLength(4);
    expect(findByKeyPrefix(tree, "dot-2026-08-22")).toHaveLength(0);
  });

  it("marks every gap, and never draws one as a bar", () => {
    const tree = deepRender(
      HealthChart({
        metric: "steps",
        points: GAPPED_SERIES,
        unit: "count",
        aggregation: "sum",
        kind: "bar",
        width: 300,
        height: 100,
      }),
    );

    const bars = findByKeyPrefix(tree, "bar-");
    const gaps = findByKeyPrefix(tree, "gap-");

    expect(bars).toHaveLength(4);
    expect(gaps).toHaveLength(2);
    expect(gaps.map((g) => g.key)).toEqual(["gap-2026-08-22", "gap-2026-08-24"]);

    // A gap marker is a hairline on the floor, never a zero-height bar (which
    // a border would still show) and never a full-height one.
    for (const gap of gaps) {
      expect(styleOf(gap).height).toBe(2);
      expect(styleOf(gap).top).toBe(98);
    }
  });

  it("keeps gap markers tiled on the same slots as the bars", () => {
    // health-chart.tsx replicates chart-geometry.ts's private slotEdge. This
    // is the guard that keeps the duplication from drifting: a gap marker's
    // left edge must land exactly where the neighbouring bar's does.
    const tree = deepRender(
      HealthChart({
        metric: "steps",
        points: GAPPED_SERIES,
        unit: "count",
        aggregation: "sum",
        kind: "bar",
        width: 300,
        height: 100,
      }),
    );

    const slotWidth = 300 / 6;
    const gap = findByKeyPrefix(tree, "gap-2026-08-22")[0]!;
    const bar = findByKeyPrefix(tree, "bar-2026-08-23")[0]!;

    expect(styleOf(gap).left).toBe(Math.round(2 * slotWidth));
    expect(styleOf(bar).left).toBe(Math.round(3 * slotWidth));
  });

  it("renders a genuine recorded zero as a visible bar, distinct from a missing day", () => {
    const tree = deepRender(
      HealthChart({
        metric: "steps",
        points: [
          point({ local_date: "2026-08-24", state: "value", value: "0" }),
          point({ local_date: "2026-08-25", state: "unknown", value: null }),
        ],
        unit: "count",
        aggregation: "sum",
        kind: "bar",
        width: 100,
        height: 50,
      }),
    );

    const bars = findByKeyPrefix(tree, "bar-");
    expect(bars).toHaveLength(1);
    expect(bars[0]!.key).toBe("bar-2026-08-24");
    expect(Number(styleOf(bars[0]!).height)).toBeGreaterThan(0);
    expect(findByKeyPrefix(tree, "gap-")).toHaveLength(1);
  });

  it("EMPTY: renders an honest empty state, not a blank box", () => {
    const tree = deepRender(
      HealthChart({
        metric: "steps",
        points: [],
        unit: "count",
        aggregation: "sum",
        kind: "bar",
        width: 300,
        height: 100,
      }),
    );

    const text = getTextContent(tree);
    expect(text).toContain("No days in this range yet.");
    expect(findByKeyPrefix(tree, "bar-")).toHaveLength(0);
    // Height is still reserved, so switching ranges does not reflow the page.
    const frame = findAll(tree, (n) => styleOf(n).height === 100)[0];
    expect(frame).toBeDefined();
  });

  it("always carries a text summary that states the counts, not just the picture", () => {
    const tree = deepRender(
      HealthChart({
        metric: "steps",
        points: GAPPED_SERIES,
        unit: "count",
        aggregation: "sum",
        kind: "bar",
        width: 300,
        height: 100,
      }),
    ) as WalkedElement;

    const text = getTextContent(tree);
    expect(text).toContain("4 of 6 days have a recorded value");
    expect(text).toContain("1 day was checked with nothing recorded");
    expect(text).toContain("1 day has not been synced");

    // The spoken label carries the same content, so the chart is not
    // colour-only for a screen reader.
    expect(tree.props?.accessibilityLabel).toBe(describeSeries("steps", GAPPED_SERIES, "count"));
  });

  it("describes a series with no readable values without claiming a zero", () => {
    const text = describeSeries(
      "sleep",
      [
        point({ local_date: "2026-08-24", state: "unknown", value: null }),
        point({ local_date: "2026-08-25", state: "unknown", value: null }),
      ],
      "seconds",
    );

    expect(text).toContain("0 of 2 days have a recorded value");
    expect(text).not.toContain("Lowest");
    expect(text).not.toContain("highest");
  });
});

// ---------------------------------------------------------------------------
// HealthTodayCard
// ---------------------------------------------------------------------------

describe("<HealthTodayCard />", () => {
  beforeEach(() => {
    vi.mocked(useHealthSummary).mockReset();
  });

  function mockSummary(data: HealthSummaryResponse | undefined): void {
    vi.mocked(useHealthSummary).mockReturnValue({
      data,
      isLoading: data === undefined,
      error: null,
    } as ReturnType<typeof useHealthSummary>);
  }

  it("renders nothing at all when there is no connection", () => {
    mockSummary(summary({ connection: null }));
    expect(HealthTodayCard()).toBeNull();
  });

  it("renders nothing when Google Health is not configured on the server", () => {
    mockSummary(summary({ configured: false, connection: null }));
    expect(HealthTodayCard()).toBeNull();
  });

  it("renders nothing while the summary is still loading, so Today never waits on health", () => {
    mockSummary(undefined);
    expect(HealthTodayCard()).toBeNull();
  });

  it("shows only metrics that actually have a value today, and never a missing one", () => {
    mockSummary(
      summary({
        today: [
          tile({ metric: "steps", unit: "count", point: point({ state: "value", value: "8140" }) }),
          // Missing for three different reasons -- none may appear.
          tile({ metric: "floors", unit: "count", point: point({ state: "verified_absent" }) }),
          tile({ metric: "sleep", unit: "seconds", point: point({ state: "unknown" }) }),
          tile({
            metric: "daily-resting-heart-rate",
            unit: "beatsPerMinute",
            point: point({ state: "unknown" }),
          }),
        ],
        capabilities: [
          capability({ metric: "steps" }),
          capability({ metric: "floors" }),
          capability({ metric: "sleep", first_data_date: null }),
          capability({ metric: "daily-resting-heart-rate", sync_enabled: false }),
        ],
      }),
    );

    const text = getTextContent(deepRender(HealthTodayCard()));

    expect(text).toContain("Steps");
    expect(text).toContain("8,140");
    // Not the label, not a zero, not an explanation -- absent entirely.
    expect(text).not.toContain("Floors");
    expect(text).not.toContain("Resting HR");
    for (const sentence of Object.values(METRIC_EXPLANATIONS)) {
      expect(text).not.toContain(sentence);
    }
  });

  it("caps the headline metrics so Today does not fill up with health", () => {
    const metrics = ["steps", "distance", "total-calories", "floors", "active-zone-minutes"];
    mockSummary(
      summary({
        today: metrics.map((metric) =>
          tile({ metric, unit: "count", point: point({ state: "value", value: "10" }) }),
        ),
        capabilities: metrics.map((metric) => capability({ metric })),
      }),
    );

    const tree = deepRender(HealthTodayCard());
    const shown = metrics.filter((metric) =>
      getTextContent(tree).includes(metric === "steps" ? "Steps" : metricShortLabelFor(metric)),
    );
    expect(shown.length).toBeLessThanOrEqual(4);
  });

  it("stays honest, and still navigable, when nothing was recorded today", () => {
    mockSummary(summary({ today: [], capabilities: [] }));

    const tree = deepRender(HealthTodayCard());
    const text = getTextContent(tree);

    expect(text).toContain("Nothing recorded for today yet.");
    expect(text).not.toMatch(/\b0\b/);

    const buttons = findButtons(tree);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.props?.accessibilityRole).toBe("button");
    expect(String(buttons[0]!.props?.className)).toContain("min-h-[44px]");
  });
});

// Local mirror of format.ts's short labels, used only by the cap test above so
// it does not have to hardcode display strings that live elsewhere.
function metricShortLabelFor(metric: string): string {
  const labels: Record<string, string> = {
    steps: "Steps",
    distance: "Distance",
    "total-calories": "Total cal",
    floors: "Floors",
    "active-zone-minutes": "Zone min",
  };
  return labels[metric] ?? metric;
}
