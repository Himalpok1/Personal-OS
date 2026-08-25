import { healthConnections } from "@personal-os/db";
import {
  createGoogleHealthClient,
  DATA_SOURCE_FAMILY_ALL,
  getHealthMetric,
  HEALTH_METRICS,
  type GoogleHealthClient,
} from "@personal-os/health-providers";
import { createDbClient } from "@personal-os/db";
import { env } from "../env.js";
import { resolveFreshAccessToken } from "../services/health-connection.js";

// READ-ONLY capability probe for Checkpoint 6.2P.
//
// Issues one bounded request per catalog metric against the live development
// account and classifies the outcome. It NEVER prints a health value, a raw
// payload, or any credential -- only classifications, counts and time bounds.
//
// Writes nothing to the health data tables. Performs no backfill.

type Classification =
  | "available_with_data"
  | "supported_but_empty"
  | "missing_scope"
  | "not_supported"
  | "provider_error";

interface Row {
  metric: string;
  mode: string;
  method: string;
  classification: Classification;
  records: number;
  pages: number;
  earliest: string | null;
  latest: string | null;
  note: string;
}

const PROBE_DAYS = 7;

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

function classifyError(err: unknown): { classification: Classification; note: string } {
  const e = err as { httpStatus?: number; googleStatus?: string; message?: string };
  if (e.httpStatus === 403) return { classification: "missing_scope", note: "403" };
  if (e.httpStatus === 400 || e.httpStatus === 404) {
    return { classification: "not_supported", note: `HTTP ${e.httpStatus}` };
  }
  return { classification: "provider_error", note: `HTTP ${e.httpStatus ?? "?"}` };
}

async function probeMetric(
  client: GoogleHealthClient,
  token: string,
  metric: string,
): Promise<Row> {
  const def = getHealthMetric(metric);
  const start = daysAgo(PROBE_DAYS);
  const end = daysAgo(0);
  const base: Row = {
    metric,
    mode: def.mode,
    method: def.method,
    classification: "supported_but_empty",
    records: 0,
    pages: 0,
    earliest: null,
    latest: null,
    note: "",
  };

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
      const pts = res.rollupDataPoints;
      base.pages = 1;
      base.records = pts.length;
      base.note = res.nextPageToken ? "nextPageToken PRESENT" : "no nextPageToken";
      const stamps = pts
        .map((p) => timeKeyOf(p as Record<string, unknown>))
        .filter((t): t is string => t !== null);
      stamps.sort();
      base.earliest = stamps[0] ?? null;
      base.latest = stamps[stamps.length - 1] ?? null;
      base.classification = pts.length > 0 ? "available_with_data" : "supported_but_empty";
      return base;
    }

    const filter = `${def.filterPath} >= "${civilStamp(start)}" AND ${def.filterPath} < "${civilStamp(end)}"`;
    let pageToken: string | undefined;
    const stamps: string[] = [];
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
      base.pages += 1;
      base.records += res.dataPoints.length;
      for (const p of res.dataPoints) {
        const t = timeKeyOf(p);
        if (t) stamps.push(t);
      }
      pageToken = res.nextPageToken;
    } while (pageToken && base.pages < 20);
    stamps.sort();
    base.earliest = stamps[0] ?? null;
    base.latest = stamps[stamps.length - 1] ?? null;
    base.classification = base.records > 0 ? "available_with_data" : "supported_but_empty";
    base.note = base.pages > 1 ? `paged x${base.pages}` : "single page";
    return base;
  } catch (err) {
    const { classification, note } = classifyError(err);
    return { ...base, classification, note };
  }
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
    // Stay well under the 300 req/min per-user limit.
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(JSON.stringify({ probeDays: PROBE_DAYS, rows }, null, 2));
  await db.$client.end();
}

main().catch((err: unknown) => {
  console.error("PROBE FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
