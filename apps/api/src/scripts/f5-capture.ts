import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createDbClient, healthConnections } from "@personal-os/db";
import { parseGoogleDuration } from "@personal-os/core";
import {
  createGoogleHealthClient,
  DATA_SOURCE_FAMILY_ALL,
  reconciledHeartRateKey,
  contentHash,
} from "@personal-os/health-providers";
import { env } from "../env.js";
import { resolveFreshAccessToken } from "../services/health-connection.js";

// F5 GATE (plan Appendix A1.2): does `reconcile` return STABLE identities across
// calls?
//
// It recomputes off-wrist filtering server-side per request, so an omission is
// evidence of upstream recomputation rather than deletion. If keys churn between
// two fetches of the same immutable past window, the derived-key scheme is not
// usable and raw heart rate must fall back to `list` + local de-duplication.
//
// This script fetches ONE fully-paginated 24-hour window and persists a SAFE
// artifact: hashes, key counts and row counts only. No token, no BPM value, no
// raw payload. The second capture must happen ~a day later; comparing two
// back-to-back calls would prove nothing about recomputation over time.

const ARTIFACT_DIR = join(homedir(), ".personal-os-phase6", "f5");

interface Artifact {
  capturedAt: string;
  civilDate: string;
  method: "reconcile";
  dataSourceFamily: string;
  recordCount: number;
  pageCount: number;
  nonEmptyDataPointNameCount: number;
  distinctExternalKeyCount: number;
  duplicateKeyCount: number;
  keySourceBreakdown: Record<string, number>;
  /** sha256 over the sorted external-key list -- the stability fingerprint. */
  externalKeySetHash: string;
  /** sha256 over the sorted content hashes -- detects value-level drift. */
  contentSetHash: string;
  earliestSampleUtc: string | null;
  latestSampleUtc: string | null;
}

function setHash(values: string[]): string {
  return createHash("sha256")
    .update([...values].sort().join("\n"))
    .digest("hex");
}

async function capture(civilDate: string): Promise<Artifact> {
  const db = createDbClient(env.DATABASE_URL);
  const [connection] = await db.select().from(healthConnections);
  if (!connection) throw new Error("no health connection");
  const { accessToken } = await resolveFreshAccessToken(db, connection);
  const client = createGoogleHealthClient();

  const next = new Date(Date.parse(`${civilDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const filter =
    `heart_rate.sample_time.civil_time >= "${civilDate}T00:00:00" ` +
    `AND heart_rate.sample_time.civil_time < "${next}T00:00:00"`;

  const keys: string[] = [];
  const contents: string[] = [];
  const sources: Record<string, number> = {};
  const instants: string[] = [];
  let named = 0;
  let pages = 0;
  let pageToken: string | undefined;

  do {
    const res = await client.reconcile({
      accessToken,
      dataType: "heart-rate",
      filter,
      pageSize: 10000,
      ...(pageToken ? { pageToken } : {}),
      dataSourceFamily: DATA_SOURCE_FAMILY_ALL,
    });
    pages += 1;
    for (const raw of res.dataPoints) {
      const p = raw as Record<string, unknown>;
      const hr = (p["heartRate"] ?? {}) as Record<string, unknown>;
      const st = (hr["sampleTime"] ?? {}) as Record<string, unknown>;
      const meta = (hr["metadata"] ?? {}) as Record<string, unknown>;
      // Narrow explicitly rather than String()-ing an unknown: a nested object
      // would stringify to "[object Object]" and silently poison the key.
      const physicalTime = typeof st["physicalTime"] === "string" ? st["physicalTime"] : "";
      const rawOffset = st["utcOffset"];
      const offset = typeof rawOffset === "string" ? parseGoogleDuration(rawOffset) : 0;
      const bpm = Number(hr["beatsPerMinute"] ?? 0);
      const dataPointName = typeof p["dataPointName"] === "string" ? p["dataPointName"] : null;
      if (dataPointName && dataPointName.length > 0) named += 1;

      const k = reconciledHeartRateKey({
        dataPointName,
        physicalTime,
        utcOffsetSeconds: offset,
        beatsPerMinute: bpm,
        motionContext: (meta["motionContext"] as string) ?? null,
        sensorLocation: (meta["sensorLocation"] as string) ?? null,
      });
      keys.push(k.key);
      sources[k.source] = (sources[k.source] ?? 0) + 1;
      contents.push(contentHash({ bpm, physicalTime, offset }));
      if (physicalTime) instants.push(physicalTime);
    }
    pageToken = res.nextPageToken;
  } while (pageToken && pages < 50);

  await db.$client.end();
  instants.sort();
  const distinct = new Set(keys);

  return {
    capturedAt: new Date().toISOString(),
    civilDate,
    method: "reconcile",
    dataSourceFamily: DATA_SOURCE_FAMILY_ALL,
    recordCount: keys.length,
    pageCount: pages,
    nonEmptyDataPointNameCount: named,
    distinctExternalKeyCount: distinct.size,
    duplicateKeyCount: keys.length - distinct.size,
    keySourceBreakdown: sources,
    externalKeySetHash: setHash([...distinct]),
    contentSetHash: setHash(contents),
    earliestSampleUtc: instants[0] ?? null,
    latestSampleUtc: instants[instants.length - 1] ?? null,
  };
}

function compare(a: Artifact, b: Artifact): void {
  const stable = a.externalKeySetHash === b.externalKeySetHash;
  console.log("F5 COMPARISON");
  console.log("  window            :", a.civilDate, "(both captures)");
  console.log(
    "  capture 1         :",
    a.capturedAt,
    "| records",
    a.recordCount,
    "| distinct keys",
    a.distinctExternalKeyCount,
  );
  console.log(
    "  capture 2         :",
    b.capturedAt,
    "| records",
    b.recordCount,
    "| distinct keys",
    b.distinctExternalKeyCount,
  );
  console.log(
    "  elapsed hours     :",
    ((Date.parse(b.capturedAt) - Date.parse(a.capturedAt)) / 3600000).toFixed(1),
  );
  console.log("  key set identical :", stable);
  console.log("  content identical :", a.contentSetHash === b.contentSetHash);
  console.log("");
  console.log(
    stable
      ? "  VERDICT: PASS -- reconcile identity is stable; the derived key is usable."
      : "  VERDICT: FAIL -- keys churned; raw HR must fall back to list + local de-dup.",
  );
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  if (cmd === "compare") {
    const a = JSON.parse(readFileSync(join(ARTIFACT_DIR, "capture-1.json"), "utf8")) as Artifact;
    const b = JSON.parse(readFileSync(join(ARTIFACT_DIR, "capture-2.json"), "utf8")) as Artifact;
    compare(a, b);
    return;
  }

  const civilDate = arg ?? "2026-04-29";
  const slot = cmd === "second" ? "capture-2" : "capture-1";
  const path = join(ARTIFACT_DIR, `${slot}.json`);
  if (existsSync(path) && cmd !== "second") {
    console.log("capture-1 already exists; refusing to overwrite:", path);
    return;
  }
  const artifact = await capture(civilDate);
  writeFileSync(path, JSON.stringify(artifact, null, 2) + "\n");
  console.log("F5", slot, "written to", path);
  console.log(JSON.stringify(artifact, null, 2));
}

main().catch((err: unknown) => {
  console.error("F5 FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
