import { devices, type Db } from "@personal-os/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../../test/build-test-db.js";
import {
  createMailDigestNotifier,
  mailDigestDedupeKey,
  mailDigestNotificationBody,
} from "./notify.js";

const db: Db = buildTestDb();

/** 23:00 in America/Chicago on 2026-09-01 (CDT, UTC-5). */
const INSIDE_QUIET_HOURS = new Date("2026-09-02T04:00:00.000Z");
/** 15:00 in America/Chicago on 2026-09-01. */
const OUTSIDE_QUIET_HOURS = new Date("2026-09-01T20:00:00.000Z");

interface SentJob {
  queue: string;
  data: Record<string, unknown>;
  options: Record<string, unknown>;
}

/** A pg-boss stand-in that records what would have been enqueued. */
function fakeBoss() {
  const sent: SentJob[] = [];
  return {
    sent,
    boss: {
      send: (queue: string, data: Record<string, unknown>, options: Record<string, unknown>) => {
        sent.push({ queue, data, options });
        return Promise.resolve("job-id");
      },
    } as never,
  };
}

async function seedDevice(overrides: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(devices)
    .values({
      name: `device-${Math.random().toString(36).slice(2, 8)}`,
      platform: "android",
      tokenHash: `hash-${Math.random().toString(36).slice(2)}`,
      notifyDigests: true,
      notificationsEnabled: true,
      ...overrides,
    })
    .returning({ id: devices.id });
  return row!.id;
}

const NOTIFICATION = {
  digestDate: "2026-09-01",
  timezone: "America/Chicago",
  now: OUTSIDE_QUIET_HOURS,
};

beforeEach(async () => {
  await truncateTestTables(db);
});

afterAll(async () => {
  await truncateTestTables(db);
  await db.$client.end();
});

describe("eligibility", () => {
  it("enqueues one job per eligible device", async () => {
    await seedDevice();
    await seedDevice();
    const { sent, boss } = fakeBoss();

    await createMailDigestNotifier(db, boss)(NOTIFICATION);

    expect(sent).toHaveLength(2);
    expect(sent[0]!.data["category"]).toBe("digest");
    // The EXISTING category and the EXISTING router -- no new category, no new
    // device column (the owner's constraint, and ADR-055's precedent).
    expect(sent[0]!.queue).toBe("notifications.dispatch");
  });

  it("skips a device with digests turned off", async () => {
    await seedDevice({ notifyDigests: false });
    const { sent, boss } = fakeBoss();
    await createMailDigestNotifier(db, boss)(NOTIFICATION);
    expect(sent).toHaveLength(0);
  });

  it("skips a device with notifications disabled entirely", async () => {
    await seedDevice({ notificationsEnabled: false });
    const { sent, boss } = fakeBoss();
    await createMailDigestNotifier(db, boss)(NOTIFICATION);
    expect(sent).toHaveLength(0);
  });

  it("skips a REVOKED device", async () => {
    await seedDevice({ revokedAt: new Date() });
    const { sent, boss } = fakeBoss();
    await createMailDigestNotifier(db, boss)(NOTIFICATION);
    expect(sent).toHaveLength(0);
  });

  it("is a no-op, not a failure, when there is no queue", async () => {
    // The digest row is already committed by the time this runs, so a missing
    // queue must cost a notification and never a fact.
    await seedDevice();
    await expect(createMailDigestNotifier(db, null)(NOTIFICATION)).resolves.toBeUndefined();
  });
});

describe("quiet hours DELAY rather than suppress (ADR-053 amendment E)", () => {
  it("sends immediately when a device has no quiet hours", async () => {
    await seedDevice();
    const { sent, boss } = fakeBoss();
    await createMailDigestNotifier(db, boss)(NOTIFICATION);
    expect(sent[0]!.options).toEqual({});
  });

  it("sends immediately when the device is OUTSIDE its quiet hours", async () => {
    await seedDevice({
      quietHoursStart: "22:00",
      quietHoursEnd: "06:00",
      quietHoursTimezone: "America/Chicago",
    });
    const { sent, boss } = fakeBoss();
    await createMailDigestNotifier(db, boss)({ ...NOTIFICATION, now: OUTSIDE_QUIET_HOURS });
    expect(sent[0]!.options).toEqual({});
  });

  it("DEFERS to the exact end of the window instead of dropping", async () => {
    // The whole point. Without `startAfter`, the router drops this device with
    // no dispatch-log row and a job that completes successfully -- so the digest
    // notification is lost every day, permanently and silently.
    await seedDevice({
      quietHoursStart: "22:00",
      quietHoursEnd: "06:00",
      quietHoursTimezone: "America/Chicago",
    });
    const { sent, boss } = fakeBoss();

    await createMailDigestNotifier(db, boss)({ ...NOTIFICATION, now: INSIDE_QUIET_HOURS });

    expect(sent).toHaveLength(1);
    // 06:00 CDT on 2026-09-02 = 11:00 UTC.
    expect((sent[0]!.options["startAfter"] as Date).toISOString()).toBe("2026-09-02T11:00:00.000Z");
  });

  it("defers PER DEVICE, so one sleeping device does not delay another", async () => {
    // Quiet hours are a per-device setting, so a single job for every device
    // could only ever honour one device's schedule.
    await seedDevice({
      quietHoursStart: "22:00",
      quietHoursEnd: "06:00",
      quietHoursTimezone: "America/Chicago",
    });
    await seedDevice();
    const { sent, boss } = fakeBoss();

    await createMailDigestNotifier(db, boss)({ ...NOTIFICATION, now: INSIDE_QUIET_HOURS });

    const deferred = sent.filter((job) => job.options["startAfter"] !== undefined);
    const immediate = sent.filter((job) => job.options["startAfter"] === undefined);
    expect(deferred).toHaveLength(1);
    expect(immediate).toHaveLength(1);
  });

  it("honours each device's OWN timezone", async () => {
    // 23:00 Chicago is 16:00 the next day in Auckland -- awake.
    await seedDevice({
      quietHoursStart: "22:00",
      quietHoursEnd: "06:00",
      quietHoursTimezone: "Pacific/Auckland",
    });
    const { sent, boss } = fakeBoss();
    await createMailDigestNotifier(db, boss)({ ...NOTIFICATION, now: INSIDE_QUIET_HOURS });
    expect(sent[0]!.options).toEqual({});
  });
});

describe("dedupe key", () => {
  it("carries the digest date AND timezone", () => {
    // `notification_dispatch_log.dedupe_key` is a permanent primary key with no
    // TTL. A key without a per-occurrence discriminator burns itself on the
    // first send and the digest can never notify again -- the exact defect the
    // pre-existing `calendar-needs-reauth:${connectionId}` producer has.
    expect(mailDigestDedupeKey("2026-09-01", "America/Chicago")).toBe(
      "mail-digest:2026-09-01:America/Chicago",
    );
  });

  it("differs across days, so tomorrow's digest can notify", () => {
    expect(mailDigestDedupeKey("2026-09-01", "UTC")).not.toBe(
      mailDigestDedupeKey("2026-09-02", "UTC"),
    );
  });

  it("differs across timezones, which are half the digest's identity", () => {
    expect(mailDigestDedupeKey("2026-09-01", "UTC")).not.toBe(
      mailDigestDedupeKey("2026-09-01", "America/Chicago"),
    );
  });

  it("is the same for every device -- the router adds the device suffix", async () => {
    await seedDevice();
    await seedDevice();
    const { sent, boss } = fakeBoss();
    await createMailDigestNotifier(db, boss)(NOTIFICATION);
    expect(new Set(sent.map((job) => job.data["dedupeKey"])).size).toBe(1);
  });
});

describe("copy safety (ADR-054)", () => {
  // A push renders on a lock screen, and the digest text is model prose derived
  // from attacker-authored subject lines. ADR-054: no subject, address or
  // display name may appear in a push body.

  it("body is a fixed literal plus the date", () => {
    expect(mailDigestNotificationBody("2026-09-01")).toBe(
      "Your mail digest for 2026-09-01 is ready.",
    );
  });

  it("carries NO digest text, sender, subject or address anywhere in the job", async () => {
    await seedDevice();
    const { sent, boss } = fakeBoss();
    await createMailDigestNotifier(db, boss)(NOTIFICATION);

    const serialized = JSON.stringify(sent[0]);
    for (const forbidden of ["@", "subject", "Subject", "from_display_name", "http"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("payload carries ids and a date only", async () => {
    await seedDevice();
    const { sent, boss } = fakeBoss();
    await createMailDigestNotifier(db, boss)(NOTIFICATION);
    expect(sent[0]!.data["data"]).toEqual({
      mailDigestDate: "2026-09-01",
      mailDigestTimezone: "America/Chicago",
    });
  });
});
