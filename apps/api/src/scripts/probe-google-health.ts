import { healthConnections } from "@personal-os/db";
import {
  classifyCapability,
  createGoogleHealthClient,
  DATA_SOURCE_FAMILY_ALL,
  getHealthMetric,
  HEALTH_METRICS,
  sanitizeApiError,
  type GoogleHealthClient,
  type HealthCapability,
  type HealthMetricDefinition,
  type ProviderFault,
} from "@personal-os/health-providers";
import { createDbClient } from "@personal-os/db";
import { env } from "../env.js";
import { resolveFreshAccessToken } from "../services/health-connection.js";

// READ-ONLY capability probe for the Google Health integration.
//
// Issues bounded requests per catalog metric against the live development
// account and classifies the outcome. It NEVER prints a health value, a raw
// payload, or any credential -- only classifications, counts and time bounds.
//
// Writes nothing to the health data tables. Performs no backfill.
//
// ---------------------------------------------------------------------------
// WHAT CHANGED AFTER 6.2P, AND WHY
//
// 1. Classification moved out of this file entirely, into
//    @personal-os/health-providers sync/capability. The old local classifier
//    mapped 403 -> missing_scope and 400/404 -> not_supported, which produced a
//    materially false report: two request-shape defects OF OURS (a
//    startTime/start field-name error and an unsupported pageSize) made every
//    dailyRollUp call return HTTP 400, and the probe reported all eight rollup
//    metrics as unsupported by the provider. They were not. An HTTP status
//    alone never decides a capability verdict; only an evidenced reason token
//    does, and every other failure is reported as provider_error.
//
// 2. A second, bounded HISTORICAL lookback runs for metrics that came back
//    empty in the recent window. On this account heart rate and sleep DO exist,
//    just older than 30 days -- reporting them as merely "empty" implied the
//    streams were wrong. They now report historical_data_outside_window, which
//    is the honest and materially different answer.
//
// ---------------------------------------------------------------------------
// INFERENCE, NOT AN API FACT
//
// The conclusion "this account has no connected wearable" is an INFERENCE drawn
// from the shape of the results (phone-derivable metrics carry data; every
// wearable-derived metric does not). The Google Health API exposes no
// paired-device information under the three scopes this project requests --
// pairedDevices.list requires googlehealth.settings.readonly, a fourth scope
// that was deliberately cut rather than silently widening consent. Nothing in
// this probe's output confirms or refutes which devices are paired.

interface Row {
  metric: string;
  mode: string;
  method: string;
  capability: HealthCapability;
  failureClass: string | null;
  /** Records in the recent window only. */
  records: number;
  pages: number;
  earliest: string | null;
  latest: string | null;
  /**
   * A date found in the historical lookback, or null if none was found (or the
   * lookback did not run because the recent window already had data).
   *
   * This is NOT a first-ever date. The lookback walks backwards and stops at
   * the first chunk that returns anything, so this is the MOST RECENT date
   * found outside the recent window. It is evidence that the stream is real;
   * classifyCapability only tests it for nullness, and a true first-data date
   * would require an unbounded scan this probe deliberately does not perform.
   */
  historicalDataDate: string | null;
  historicalChunksTried: number;
  note: string;
}

const RECENT_DAYS = 7;
/** Bounded historical lookback: days 30..120 back, walked newest-first. */
const LOOKBACK_START_DAYS = 30;
const LOOKBACK_END_DAYS = 120;
/** Hard ceiling on chunks per metric, so a narrow range cap cannot fan out. */
const MAX_LOOKBACK_CHUNKS = 8;
/** Stay well under the 300 req/min per-user limit. */
const REQUEST_SPACING_MS = 400;

function civilOf(date: Date) {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function civilStamp(date: Date): string {
  return `${isoDate(date)}T00:00:00`;
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Pulls a comparable timestamp/date out of a record without exposing values. */
function timeKeyOf(point: Record<string, unknown>): string | null {
  const seen: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > 4 || node === null || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) seen.push(v);
      else if (k === "date" && v && typeof v === "object") {
        const d = v as { year?: number; month?: number; day?: number };
        if (d.year) {
          seen.push(
            `${d.year}-${String(d.month ?? 1).padStart(2, "0")}-${String(d.day ?? 1).padStart(2, "0")}`,
          );
        }
      } else walk(v, depth + 1);
    }
  };
  walk(point, 0);
  seen.sort();
  return seen[0] ?? null;
}

interface WindowResult {
  records: number;
  pages: number;
  earliest: string | null;
  latest: string | null;
  /** null when the window was fetched successfully. */
  fault: ProviderFault | null;
  note: string;
}

/** One bounded fetch of [start, end) for one metric. Never throws. */
async function probeWindow(
  client: GoogleHealthClient,
  token: string,
  def: HealthMetricDefinition,
  start: Date,
  end: Date,
): Promise<WindowResult> {
  const result: WindowResult = {
    records: 0,
    pages: 0,
    earliest: null,
    latest: null,
    fault: null,
    note: "",
  };
  const stamps: string[] = [];

  try {
    if (def.method === "dailyRollUp") {
      const res = await client.dailyRollUp({
        accessToken: token,
        dataType: def.googleDataType,
        range: {
          start: { date: civilOf(start), time: { hours: 0 } },
          end: { date: civilOf(end), time: { hours: 0 } },
        },
        windowSizeDays: 1,
        dataSourceFamily: DATA_SOURCE_FAMILY_ALL,
      });
      result.pages = 1;
      result.records = res.rollupDataPoints.length;
      result.note = res.nextPageToken ? "nextPageToken PRESENT" : "no nextPageToken";
      for (const p of res.rollupDataPoints) {
        const t = timeKeyOf(p);
        if (t) stamps.push(t);
      }
    } else {
      const filter = `${def.filterPath} >= "${civilStamp(start)}" AND ${def.filterPath} < "${civilStamp(end)}"`;
      let pageToken: string | undefined;
      do {
        const res =
          def.method === "reconcile"
            ? await client.reconcile({
                accessToken: token,
                dataType: def.googleDataType,
                filter,
                pageSize: def.pageSize,
                ...(pageToken ? { pageToken } : {}),
                dataSourceFamily: DATA_SOURCE_FAMILY_ALL,
              })
            : await client.list({
                accessToken: token,
                dataType: def.googleDataType,
                filter,
                pageSize: def.pageSize,
                ...(pageToken ? { pageToken } : {}),
              });
        result.pages += 1;
        result.records += res.dataPoints.length;
        for (const p of res.dataPoints) {
          const t = timeKeyOf(p);
          if (t) stamps.push(t);
        }
        pageToken = res.nextPageToken;
      } while (pageToken && result.pages < 20);
      result.note = result.pages > 1 ? `paged x${result.pages}` : "single page";
    }
  } catch (err) {
    // sanitizeApiError keeps only enumerable tokens. Google's error.message is
    // dropped here as it is everywhere else: its INVALID_ARGUMENT prose echoes
    // the request, and this probe prints its output.
    result.fault = sanitizeApiError(err);
    result.note = `${result.fault.googleStatus ?? `HTTP ${result.fault.httpStatus}`}${
      result.fault.reasons.length > 0 ? ` [${result.fault.reasons.join(",")}]` : ""
    }`;
    return result;
  }

  stamps.sort();
  result.earliest = stamps[0] ?? null;
  result.latest = stamps[stamps.length - 1] ?? null;
  return result;
}

/**
 * Walks days 30..120 back in chunks, newest-first, stopping at the first chunk
 * that returns anything.
 *
 * Chunk width is clamped to the metric's own maxRangeDays, which is not
 * cosmetic: heart-rate and total-calories carry a DOCUMENTED 14-day rollup cap,
 * and sessions are capped at 30 by our own choice, so a flat 90-day lookback
 * would be rejected outright and would then be misread as a capability verdict
 * -- the precise failure mode this rewrite exists to remove.
 */
async function probeHistory(
  client: GoogleHealthClient,
  token: string,
  def: HealthMetricDefinition,
): Promise<{ date: string | null; chunks: number; fault: ProviderFault | null; note: string }> {
  const width = Math.min(30, def.maxRangeDays);
  let chunks = 0;
  for (
    let back = LOOKBACK_START_DAYS;
    back < LOOKBACK_END_DAYS && chunks < MAX_LOOKBACK_CHUNKS;
    back += width
  ) {
    const end = daysAgo(back);
    const start = daysAgo(Math.min(back + width, LOOKBACK_END_DAYS));
    chunks += 1;
    const res = await probeWindow(client, token, def, start, end);
    if (res.fault) return { date: null, chunks, fault: res.fault, note: `lookback: ${res.note}` };
    if (res.records > 0) {
      return {
        date: res.latest ?? res.earliest,
        chunks,
        fault: null,
        note: `lookback hit at ${isoDate(start)}..${isoDate(end)}`,
      };
    }
    await sleep(REQUEST_SPACING_MS);
  }
  return { date: null, chunks, fault: null, note: `lookback empty over ${chunks} chunk(s)` };
}

async function probeMetric(
  client: GoogleHealthClient,
  token: string,
  metric: string,
): Promise<Row> {
  const def = getHealthMetric(metric);
  const recent = await probeWindow(client, token, def, daysAgo(RECENT_DAYS), daysAgo(0));

  let historicalDataDate: string | null = null;
  let historicalChunksTried = 0;
  let fault = recent.fault;
  let note = recent.note;

  // The lookback runs ONLY when the recent window was fetched cleanly and came
  // back empty. A fault is already decisive, and records already prove the
  // stream, so neither case earns extra requests against the rate limit.
  if (!recent.fault && recent.records === 0) {
    await sleep(REQUEST_SPACING_MS);
    const history = await probeHistory(client, token, def);
    historicalDataDate = history.date;
    historicalChunksTried = history.chunks;
    fault = history.fault;
    note = note ? `${note}; ${history.note}` : history.note;
  }

  const { capability, failureClass } = classifyCapability({
    fault,
    recordCount: recent.records,
    firstDataDate: historicalDataDate,
  });

  return {
    metric,
    mode: def.mode,
    method: def.method,
    capability,
    failureClass,
    records: recent.records,
    pages: recent.pages,
    earliest: recent.earliest,
    latest: recent.latest,
    historicalDataDate,
    historicalChunksTried,
    note,
  };
}

async function main(): Promise<void> {
  const db = createDbClient(env.DATABASE_URL);
  const [connection] = await db.select().from(healthConnections);
  if (!connection) throw new Error("no health connection");
  const { accessToken } = await resolveFreshAccessToken(db, connection);
  const client = createGoogleHealthClient();

  const rows: Row[] = [];
  for (const metric of HEALTH_METRICS) {
    rows.push(await probeMetric(client, accessToken, metric));
    await sleep(REQUEST_SPACING_MS);
  }

  console.log(
    JSON.stringify(
      {
        recentWindowDays: RECENT_DAYS,
        historicalLookbackDaysBack: [LOOKBACK_START_DAYS, LOOKBACK_END_DAYS],
        caveats: [
          "A capability verdict comes only from an evidenced reason token. Every " +
            "other failure is provider_error, which is NOT a claim about the provider.",
          "failureClass 'client_request_defect:*' means OUR request was wrong, not " +
            "that the metric is unsupported.",
          "'No connected wearable' is an INFERENCE from the result shape, not an API " +
            "fact: paired-device listing needs a fourth scope this project does not request.",
          "historicalDataDate is the most recent date found in the bounded lookback, " +
            "not a first-ever date.",
        ],
        rows,
      },
      null,
      2,
    ),
  );
  await db.$client.end();
}

main().catch((err: unknown) => {
  console.error("PROBE FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
