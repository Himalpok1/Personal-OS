import { monitorTargets, type Db } from "@personal-os/db";
import { MonitorTargetCreateSchema, type MonitorTargetCreate } from "@personal-os/schema";
import { asc, eq } from "drizzle-orm";

// Target management.
//
// Targets are ROWS, not constants (ADR-055). What is actually watched in
// production is whatever this table says, not what someone believed when the
// image was built -- and changing it does not need a deploy.

export type MonitorTargetRow = typeof monitorTargets.$inferSelect;

/**
 * Creates a target, validating through the shared contract first.
 *
 * The Zod parse is not redundant with the database CHECKs: the CHECKs enforce
 * shape (a positive timeout, an all-or-nothing maintenance triple), while the
 * refines enforce the CROSS-FIELD rules SQL cannot express usefully -- an `http`
 * target needs a URL, a `worker_heartbeat` target must not have one, and
 * `tls_warn_days` on a plaintext URL would produce a probe that can never
 * succeed and an alert nobody can act on.
 */
export async function createMonitorTarget(
  db: Db,
  input: MonitorTargetCreate,
): Promise<MonitorTargetRow> {
  const parsed = MonitorTargetCreateSchema.parse(input);
  const [row] = await db
    .insert(monitorTargets)
    .values({
      name: parsed.name,
      kind: parsed.kind,
      url: parsed.url ?? null,
      ...(parsed.expected_status !== undefined ? { expectedStatus: parsed.expected_status } : {}),
      ...(parsed.expect_healthy_payload !== undefined
        ? { expectHealthyPayload: parsed.expect_healthy_payload }
        : {}),
      ...(parsed.timeout_ms !== undefined ? { timeoutMs: parsed.timeout_ms } : {}),
      ...(parsed.interval_seconds !== undefined
        ? { intervalSeconds: parsed.interval_seconds }
        : {}),
      ...(parsed.failure_threshold !== undefined
        ? { failureThreshold: parsed.failure_threshold }
        : {}),
      ...(parsed.recovery_threshold !== undefined
        ? { recoveryThreshold: parsed.recovery_threshold }
        : {}),
      tlsWarnDays: parsed.tls_warn_days ?? null,
      heartbeatMaxAgeSeconds: parsed.heartbeat_max_age_seconds ?? null,
      ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
      maintenanceStart: parsed.maintenance_start ?? null,
      maintenanceEnd: parsed.maintenance_end ?? null,
      maintenanceTimezone: parsed.maintenance_timezone ?? null,
      mutedUntil:
        parsed.muted_until === undefined || parsed.muted_until === null
          ? null
          : new Date(parsed.muted_until),
    })
    .returning();
  return row!;
}

/** Every target, oldest name first, so listings are stable. */
export async function listMonitorTargets(db: Db): Promise<MonitorTargetRow[]> {
  return await db.select().from(monitorTargets).orderBy(asc(monitorTargets.name));
}

/** The targets a given process is responsible for probing. */
export async function listTargetsOfKind(
  db: Db,
  kind: "http" | "worker_heartbeat",
): Promise<MonitorTargetRow[]> {
  return await db
    .select()
    .from(monitorTargets)
    .where(eq(monitorTargets.kind, kind))
    .orderBy(asc(monitorTargets.name));
}

/** Suppresses a target until `until`. The deploy-window primitive. */
export async function muteMonitorTarget(
  db: Db,
  targetId: string,
  until: Date,
  now: Date = new Date(),
): Promise<MonitorTargetRow | undefined> {
  const [row] = await db
    .update(monitorTargets)
    .set({ mutedUntil: until, updatedAt: now })
    .where(eq(monitorTargets.id, targetId))
    .returning();
  return row;
}

export async function setMonitorTargetEnabled(
  db: Db,
  targetId: string,
  enabled: boolean,
  now: Date = new Date(),
): Promise<MonitorTargetRow | undefined> {
  const [row] = await db
    .update(monitorTargets)
    .set({ enabled, updatedAt: now })
    .where(eq(monitorTargets.id, targetId))
    .returning();
  return row;
}

export async function deleteMonitorTarget(db: Db, targetId: string): Promise<boolean> {
  const rows = await db
    .delete(monitorTargets)
    .where(eq(monitorTargets.id, targetId))
    .returning({ id: monitorTargets.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// The default target set
// ---------------------------------------------------------------------------

export interface DefaultTargetUrls {
  /** In-cluster API, e.g. http://api:3000 */
  apiBaseUrl: string;
  /** In-cluster web, e.g. http://web:8080 */
  webBaseUrl: string;
  /** Public tailnet API origin, e.g. https://host.tailnet.ts.net */
  tailnetApiOrigin?: string;
  /** Public tailnet web origin, e.g. https://host.tailnet.ts.net:8443 */
  tailnetWebOrigin?: string;
}

/**
 * The five targets ADR-055 names, as data.
 *
 * ===========================================================================
 * THE TWO TAILNET TARGETS ARE OPTIONAL, AND THAT IS AN HONESTY REQUIREMENT.
 * ===========================================================================
 *
 * ADR-055 says in so many words that "whether the worker container can reach the
 * Tailscale Serve routes from a plain bridge network is UNVERIFIED and must be
 * proven in Checkpoint 7.5, and if it cannot, the Serve/TLS layer is recorded as
 * an explicit blind spot rather than assumed covered."
 *
 * It cannot be proven here: doing so needs production access, which this
 * checkpoint does not have. So they are opt-in rather than seeded by default,
 * and a deployment that turns them on without confirming reachability would get
 * a permanently-open incident telling it something true but useless. The blind
 * spot is recorded in docs/STATUS.md rather than papered over by seeding a
 * target and hoping.
 *
 * Nothing here runs automatically. Seeding is a deliberate operator action --
 * writing production URLs into whatever database a process happens to be
 * pointed at would be exactly the wrong default.
 */
export function defaultMonitorTargets(urls: DefaultTargetUrls): MonitorTargetCreate[] {
  const targets: MonitorTargetCreate[] = [
    {
      name: "api-internal-health",
      kind: "http",
      url: `${urls.apiBaseUrl.replace(/\/+$/, "")}/health`,
      expected_status: 200,
      // Parses the body: a 200 saying `db: "unreachable"` is not up.
      expect_healthy_payload: true,
      timeout_ms: 5000,
      interval_seconds: 60,
      failure_threshold: 3,
      recovery_threshold: 2,
    },
    {
      name: "web-internal",
      kind: "http",
      url: `${urls.webBaseUrl.replace(/\/+$/, "")}/`,
      expected_status: 200,
      timeout_ms: 5000,
      interval_seconds: 300,
    },
    {
      // Evaluated by the API PROCESS, never the worker -- a worker-hosted
      // monitor cannot alert on its own death (ADR-055).
      name: "worker-heartbeat",
      kind: "worker_heartbeat",
      url: null,
      // Three minutes against a one-minute heartbeat: two consecutive missed
      // beats are noise, three are a pattern.
      heartbeat_max_age_seconds: 180,
      interval_seconds: 60,
      failure_threshold: 3,
      recovery_threshold: 2,
    },
  ];

  if (urls.tailnetApiOrigin !== undefined) {
    targets.push({
      name: "api-tailnet-health",
      kind: "http",
      url: `${urls.tailnetApiOrigin.replace(/\/+$/, "")}/health`,
      expected_status: 200,
      expect_healthy_payload: true,
      // The only TLS-bearing targets, because they are the only ones served
      // over TLS at all -- the in-cluster ones are plain HTTP on a private
      // Docker network, and `tls_warn_days` on an http:// URL is rejected by
      // the contract rather than silently ignored.
      tls_warn_days: 21,
      timeout_ms: 10000,
      interval_seconds: 300,
    });
  }

  if (urls.tailnetWebOrigin !== undefined) {
    targets.push({
      name: "web-tailnet",
      kind: "http",
      url: `${urls.tailnetWebOrigin.replace(/\/+$/, "")}/`,
      expected_status: 200,
      tls_warn_days: 21,
      timeout_ms: 10000,
      interval_seconds: 300,
    });
  }

  return targets;
}

/**
 * Idempotently seeds the default targets.
 *
 * Existing rows are LEFT ALONE rather than overwritten. Targets are operator
 * configuration: someone who widened a timeout or muted a target for a deploy
 * must not have that silently reverted by a redeploy that happens to re-run the
 * seed. New targets are added; existing ones are reported as skipped.
 */
export async function seedDefaultMonitorTargets(
  db: Db,
  urls: DefaultTargetUrls,
): Promise<{ created: string[]; skipped: string[] }> {
  const existing = new Set((await listMonitorTargets(db)).map((t) => t.name));
  const created: string[] = [];
  const skipped: string[] = [];

  for (const target of defaultMonitorTargets(urls)) {
    if (existing.has(target.name)) {
      skipped.push(target.name);
      continue;
    }
    await createMonitorTarget(db, target);
    created.push(target.name);
  }

  return { created, skipped };
}
