import { describe, expect, it } from "vitest";
import {
  FAILED_PARENT_REFS_MAX,
  OccurrencesJobError,
  withOccurrencesJobErrorContainment,
  type FailedParentRef,
} from "./occurrences-job-error.js";

// Containment for the occurrences lane (Checkpoint 9.0).
//
// What escapes an occurrences handler is the USER'S OWN DATA rather than a
// provider secret: packages/core's recurrence errors interpolate the RRULE and
// exdate strings into their messages, and a `pg` DatabaseError's `detail` on a
// constraint violation is the whole occurrence row. pg-boss persists whatever a
// failing handler throws into `pgboss.job.output` and copies it again onto the
// dead-letter job, so an unwrapped throw writes both to disk.

const RULE_TEXT = 'invalid RRULE syntax: "FREQ=DAILY;BYDAY=MO;X-PRIVATE=doctor appointment"';
const ROW_DETAIL = "Failing row contains (5f1c..., task, 9a2b..., 2026-09-13 09:00:00+00, ...)";

describe("OccurrencesJobError", () => {
  it("destroys the original message, stack and every own property", async () => {
    const cause = Object.assign(new Error(RULE_TEXT), {
      // The exact shapes a real failure carries: a pg DatabaseError's detail
      // and table, and the `cause` chain packages/core attaches to rrule
      // parse failures.
      detail: ROW_DETAIL,
      table: "occurrences",
      cause: new Error("rrule library said: doctor appointment"),
    });

    const error = await withOccurrencesJobErrorContainment("occurrences.generate-lazy", () => {
      throw cause;
    })([]).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(OccurrencesJobError);
    // Serialized the way pg-boss's serialize-error walks it: every own
    // enumerable property, plus the standard Error fields.
    const serialized = JSON.stringify({
      ...(error as OccurrencesJobError),
      message: (error as Error).message,
      stack: (error as Error).stack,
    });
    for (const forbidden of ["BYDAY", "doctor", "Failing row", "5f1c", '"table"']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect((error as Error).message).toBe("occurrences.generate-lazy failed");
  });

  it("does NOT retain `cause`", () => {
    // serialize-error special-cases `cause` rather than relying on
    // enumerability, so retaining it would walk the original error -- rule
    // text included -- straight back into the job table.
    const error = new OccurrencesJobError("occurrences.generate-lazy", new Error(RULE_TEXT));
    expect(error.cause).toBeUndefined();
  });

  it("echoes a SQLSTATE-shaped code and nothing else", () => {
    const error = new OccurrencesJobError("occurrences.generate-lazy", {
      code: "23514",
      detail: ROW_DETAIL,
    });
    expect(error.sqlState).toBe("23514");
    expect(error.message).toBe("occurrences.generate-lazy failed (23514)");
    expect(JSON.stringify(error)).not.toContain("Failing row");
  });

  it("drops a code that is not SQLSTATE-shaped", () => {
    for (const code of ["ERR_INVALID_ARG_TYPE", RULE_TEXT, "", "234567"]) {
      const error = new OccurrencesJobError("occurrences.expand-window", { code });
      expect(error.sqlState).toBeNull();
      expect(error.message).toBe("occurrences.expand-window failed");
    }
  });

  it("carries per-parent counts and the failed parents' ids for the sweep", () => {
    // The nightly expansion is a sweep over many parents; "2 of 14 failed" is
    // what an operator reading job.output needs to size it, and WHICH two is
    // what they need to fix it -- the per-parent log line is the only other
    // place the ids are named, and the worker log does not survive a
    // container recreation.
    const failed: FailedParentRef[] = [
      { parentType: "task", parentId: "11111111-1111-4111-8111-111111111111" },
      { parentType: "event", parentId: "22222222-2222-4222-8222-222222222222" },
    ];
    const error = new OccurrencesJobError("occurrences.expand-window", null, {
      failed,
      totalParents: 14,
    });
    expect(error.failedParents).toBe(2);
    expect(error.totalParents).toBe(14);
    expect(error.failedParentRefs).toEqual(failed);
    expect(error.message).toBe("occurrences.expand-window failed: 2 of 14 parents failed");
    // The complete own-enumerable surface serialize-error will walk: nothing
    // but the queue, the SQLSTATE slot, the two counts and the id list (plus
    // `name`, which is assigned in the constructor and therefore enumerable).
    expect(Object.keys(error).sort()).toEqual(
      ["failedParentRefs", "failedParents", "name", "queue", "sqlState", "totalParents"].sort(),
    );
  });

  it("bounds the id list and copies refs field by field", () => {
    // A sweep over thousands of parents must not turn job.output into a dump,
    // and a caller handing over a richer object (a row) must not smuggle its
    // other columns -- a title, a rule -- into the job table on the back of an
    // id. The COUNT stays exact even when the list is cut.
    const failed = Array.from({ length: FAILED_PARENT_REFS_MAX + 5 }, (_, i) => ({
      parentType: "task" as const,
      parentId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      title: "Pay rent to landlord",
      rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
    }));
    const error = new OccurrencesJobError("occurrences.expand-window", null, {
      failed,
      totalParents: 40,
    });
    expect(error.failedParents).toBe(FAILED_PARENT_REFS_MAX + 5);
    expect(error.failedParentRefs).toHaveLength(FAILED_PARENT_REFS_MAX);
    expect(Object.keys(error.failedParentRefs![0]!).sort()).toEqual(["parentId", "parentType"]);
    const serialized = JSON.stringify({ ...error, message: error.message });
    expect(serialized).not.toContain("landlord");
    expect(serialized).not.toContain("BYMONTHDAY");
  });

  it("survives a non-object throw", () => {
    expect(new OccurrencesJobError("occurrences.generate-lazy", "boom").sqlState).toBeNull();
    expect(new OccurrencesJobError("occurrences.generate-lazy", null).message).toBe(
      "occurrences.generate-lazy failed",
    );
  });
});

describe("withOccurrencesJobErrorContainment", () => {
  it("passes a successful handler straight through", async () => {
    const seen: number[] = [];
    const contained = withOccurrencesJobErrorContainment<number>(
      "occurrences.generate-lazy",
      (jobs) => {
        seen.push(...jobs);
        return Promise.resolve();
      },
    );

    await expect(contained([1, 2])).resolves.toBeUndefined();
    expect(seen).toEqual([1, 2]);
  });

  it("names the queue it wrapped", async () => {
    await expect(
      withOccurrencesJobErrorContainment("occurrences.generate-lazy", () =>
        Promise.reject(new Error(RULE_TEXT)),
      )([]),
    ).rejects.toMatchObject({ queue: "occurrences.generate-lazy", name: "OccurrencesJobError" });
  });

  it("lets an already-contained error through UNCHANGED, counts intact", async () => {
    // Re-wrapping would turn "2 of 14 parents failed" into a bare "failed":
    // less information for no additional safety.
    const inner = new OccurrencesJobError("occurrences.expand-window", null, {
      failed: [
        { parentType: "task", parentId: "11111111-1111-4111-8111-111111111111" },
        { parentType: "event", parentId: "22222222-2222-4222-8222-222222222222" },
      ],
      totalParents: 14,
    });
    const caught = await withOccurrencesJobErrorContainment("occurrences.expand-window", () =>
      Promise.reject(inner),
    )([]).catch((err: unknown) => err);
    expect(caught).toBe(inner);
  });
});
