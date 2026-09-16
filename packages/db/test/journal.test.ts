import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Permanent guard for the migration-journal fabrication class discovered in
// Checkpoint 5.3 STEP 0: hand-appended entries with round/future `when`
// values silently poison the runner's max(created_at) watermark and can
// suppress every future migration. See docs/STATUS.md Checkpoint 5.3.

const DRIZZLE_DIR = join(import.meta.dirname, "../drizzle");
const FUTURE_GRACE_MS = 5 * 60 * 1000;

// Migrations authored as hand-written SQL with hand-appended journal entries
// under the methodology recorded in Checkpoint 5.3 STEP 0. Extending this
// list is a deliberate, reviewed act -- each addition must also update
// docs/STATUS.md.
const HAND_WRITTEN_WITHOUT_SNAPSHOT = new Set([
  "0009_caldav_provider_support",
  "0010_project_lifecycle",
  "0011_review_history",
  "0012_ai_daily_briefs",
  "0013_google_health_sync",
  "0014_mail_integration",
  "0015_service_monitoring",
  "0016_monitor_target_archive",
  "0017_inbox_item_archive",
  "0018_occurrence_snooze",
  "0019_event_authoring",
  "0020_canvas_lms_integration",
]);

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

function loadJournal(): JournalEntry[] {
  const raw = execSync(
    `node -e "console.log(JSON.stringify(require('${join(DRIZZLE_DIR, "meta/_journal.json").replace(/\\/g, "/")}').entries))"`,
    { encoding: "utf8" },
  );
  return JSON.parse(raw) as JournalEntry[];
}

describe("drizzle migration journal guard", () => {
  const journal = loadJournal();

  it("has a contiguous, strictly ascending idx sequence starting at zero", () => {
    journal.forEach((entry, position) => {
      expect(entry.idx, `entry ${position}`).toBe(position);
    });
  });

  it("references exactly the .sql files on disk (bijection, no orphans)", () => {
    const sqlFiles = readdirSync(DRIZZLE_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""));
    expect(new Set(sqlFiles)).toEqual(new Set(journal.map((e) => e.tag)));
  });

  it("has strictly increasing `when` timestamps", () => {
    for (let i = 1; i < journal.length; i += 1) {
      expect(
        journal[i].when,
        `${journal[i].tag}.when must exceed ${journal[i - 1].tag}.when`,
      ).toBeGreaterThan(journal[i - 1].when);
    }
  });

  it("never dates an entry in the future (watermark-poisoning guard)", () => {
    for (const entry of journal) {
      expect(
        entry.when,
        `${entry.tag}.when is future-dated and would suppress subsequent migrations`,
      ).toBeLessThanOrEqual(Date.now() + FUTURE_GRACE_MS);
    }
  });

  it("keeps snapshot coverage exact: only the documented hand-written set lacks snapshots", () => {
    const missing = journal
      .map((e) => e.tag)
      .filter(
        (tag) => !existsSync(join(DRIZZLE_DIR, "meta", `${tag.split("_")[0]}_snapshot.json`)),
      );
    expect(new Set(missing)).toEqual(HAND_WRITTEN_WITHOUT_SNAPSHOT);
  });
});
