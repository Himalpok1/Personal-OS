import { describe, expect, it } from "vitest";
import { assignment } from "./fixtures.test-support";
import { partitionAssignments } from "./partition-assignments";

const NOW = Date.parse("2026-09-16T13:00:00Z");

describe("partitionAssignments", () => {
  it("splits open rows by one instant comparison and keeps closed rows apart", () => {
    const overdue = assignment({ id: "a", due_at: "2026-09-16T12:59:59Z" });
    const upcoming = assignment({ id: "b", due_at: "2026-09-16T13:00:00Z" });
    const undated = assignment({ id: "c", due_at: null });
    const closed = assignment({
      id: "d",
      due_at: "2026-09-01T00:00:00Z",
      open: false,
      submission: {
        status: "graded",
        missing: false,
        late: false,
        submitted_at: "2026-08-30T00:00:00Z",
      },
    });

    const result = partitionAssignments([overdue, upcoming, undated, closed], NOW);

    expect(result.overdue.map((a) => a.id)).toEqual(["a"]);
    // Exactly `now` is NOT overdue -- overdue is strictly before (rule 2).
    expect(result.upcoming.map((a) => a.id)).toEqual(["b"]);
    expect(result.undated.map((a) => a.id)).toEqual(["c"]);
    expect(result.closed.map((a) => a.id)).toEqual(["d"]);
  });

  it("trusts the server's `open` and never re-derives it from the submission", () => {
    // A row the server calls closed stays closed even with a future due date
    // and an unsubmitted-looking submission -- the flag is the contract.
    const closedButFuture = assignment({ id: "x", due_at: "2027-01-01T00:00:00Z", open: false });
    const result = partitionAssignments([closedButFuture], NOW);
    expect(result.closed).toHaveLength(1);
    expect(result.upcoming).toHaveLength(0);
  });

  it("puts a closed row with no due date under closed, not undated", () => {
    const result = partitionAssignments([assignment({ due_at: null, open: false })], NOW);
    expect(result.closed).toHaveLength(1);
    expect(result.undated).toHaveLength(0);
  });

  it("preserves the server's order inside each partition", () => {
    const rows = [
      assignment({ id: "1", due_at: "2026-09-10T00:00:00Z" }),
      assignment({ id: "2", due_at: "2026-09-20T00:00:00Z" }),
      assignment({ id: "3", due_at: "2026-09-12T00:00:00Z" }),
      assignment({ id: "4", due_at: "2026-09-25T00:00:00Z" }),
    ];
    const result = partitionAssignments(rows, NOW);
    expect(result.overdue.map((a) => a.id)).toEqual(["1", "3"]);
    expect(result.upcoming.map((a) => a.id)).toEqual(["2", "4"]);
  });

  it("treats an unreadable due instant on an open row as undated rather than guessing a side", () => {
    const result = partitionAssignments([assignment({ due_at: "garbage" })], NOW);
    expect(result.undated).toHaveLength(1);
    expect(result.overdue).toHaveLength(0);
    expect(result.upcoming).toHaveLength(0);
  });

  it("returns four empty partitions for no assignments", () => {
    expect(partitionAssignments([], NOW)).toEqual({
      overdue: [],
      upcoming: [],
      undated: [],
      closed: [],
    });
  });
});
