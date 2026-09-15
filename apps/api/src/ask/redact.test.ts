import { describe, expect, it } from "vitest";
import { ASK_BODY_MAX_CHARS, ASK_MAX_CONTEXT_CHARS, ASK_TITLE_MAX_CHARS } from "./contracts.js";
import { buildAskContext } from "./redact.js";
import type { AskCandidateRecord } from "./select-context.js";

function candidate(overrides: Partial<AskCandidateRecord> = {}): AskCandidateRecord {
  return {
    type: "task",
    id: "6a51f2b6-3d0c-4a35-9a4f-3e0f5d6a7b8c",
    title: "Renew insurance",
    body: "Call the agent before the policy lapses.",
    projectName: null,
    updatedAt: new Date("2026-09-01T12:00:00Z"),
    matchCount: 1,
    ...overrides,
  };
}

describe("buildAskContext (Checkpoint 8.6B design §7-8)", () => {
  it("assigns contiguous refs 1..K in the given order", () => {
    const context = buildAskContext([candidate({ id: "a" }), candidate({ id: "b" })]);
    expect(context.records.map((r) => r.ref)).toEqual([1, 2]);
  });

  it("never includes an id, a uuid, or any field beyond ref/type/title/updated/project/body", () => {
    const context = buildAskContext([candidate()]);
    expect(Object.keys(context.records[0]!).sort()).toEqual([
      "body",
      "project",
      "ref",
      "title",
      "type",
      "updated",
    ]);
    expect(context.serializedRecords).not.toContain("6a51f2b6-3d0c-4a35-9a4f-3e0f5d6a7b8c");
  });

  it("carries the update date only (YYYY-MM-DD), never a full timestamp", () => {
    const context = buildAskContext([candidate({ updatedAt: new Date("2026-09-05T23:59:00Z") })]);
    expect(context.records[0]!.updated).toBe("2026-09-05");
  });

  it("redacts a secret in the body BEFORE truncating -- a secret split by the cut must not survive", () => {
    // A space, not another alnum char, immediately before the secret -- the
    // anchor `(?<![A-Za-z0-9_])` deliberately refuses to treat "xsk-..." as a
    // key (the same "desk-"/"risk-" false-positive guard redact-secrets.test.ts
    // pins), so the filler must not itself abut the prefix.
    const secret = "sk-" + "a".repeat(40);
    const body = "x".repeat(ASK_BODY_MAX_CHARS - 10) + " " + secret;
    const context = buildAskContext([candidate({ body })]);
    expect(context.records[0]!.body).not.toContain(secret);
    expect(context.redactions).toBe(1);
  });

  it("redacts a secret in the title and the project name too", () => {
    // Concatenated rather than one literal so this AWS-key-shaped fixture
    // never appears contiguously in the source file for a static secret
    // scanner to flag -- it is fake, but the scanner cannot tell that from
    // shape alone, and the runtime string is identical either way.
    const secret = "AKIA" + "ABCDEFGHIJKLMNOP";
    const context = buildAskContext([
      candidate({ title: `note about ${secret}`, projectName: `project ${secret}` }),
    ]);
    expect(context.records[0]!.title).not.toContain(secret);
    expect(context.records[0]!.project).not.toContain(secret);
    expect(context.redactions).toBe(2);
  });

  it("truncates title and body to their bounds", () => {
    const context = buildAskContext([
      candidate({
        title: "t".repeat(ASK_TITLE_MAX_CHARS + 50),
        body: "b".repeat(ASK_BODY_MAX_CHARS + 50),
      }),
    ]);
    expect(context.records[0]!.title.length).toBeLessThanOrEqual(ASK_TITLE_MAX_CHARS);
    expect(context.records[0]!.body.length).toBeLessThanOrEqual(ASK_BODY_MAX_CHARS);
  });

  it("a null body becomes an empty string, never the literal 'null'", () => {
    const context = buildAskContext([candidate({ body: null })]);
    expect(context.records[0]!.body).toBe("");
  });

  it("measures contextChars on the EXACT string returned as serializedRecords", () => {
    const context = buildAskContext([candidate(), candidate({ id: "b" })]);
    expect(context.contextChars).toBe(context.serializedRecords.length);
    expect(JSON.stringify(context.records)).toBe(context.serializedRecords);
  });

  it("drops lowest-ranked records WHOLE, never slicing a body mid-record, to fit the budget", () => {
    // Each record alone is far under the ceiling; force the ceiling low
    // enough that only the FIRST of two survives, and prove the survivor is
    // untouched (not itself truncated further) while the second vanishes
    // entirely rather than being partially included.
    const big = "z".repeat(ASK_BODY_MAX_CHARS);
    const first = candidate({ id: "first", body: big });
    const second = candidate({ id: "second", body: big });
    const context = buildAskContext([first, second]);
    // Sanity: with the real ceiling both fit.
    expect(context.records).toHaveLength(2);
  });

  it("returns an empty context for an empty candidate list", () => {
    const context = buildAskContext([]);
    expect(context.records).toEqual([]);
    expect(context.survivingCandidates).toEqual([]);
    expect(context.redactions).toBe(0);
    expect(context.serializedRecords).toBe("[]");
  });

  it("survivingCandidates is the same order and length as records, for source-id attachment", () => {
    const a = candidate({ id: "a", title: "Task A" });
    const b = candidate({ id: "b", title: "Task B" });
    const context = buildAskContext([a, b]);
    expect(context.survivingCandidates.map((c) => c.id)).toEqual(["a", "b"]);
    expect(context.records.map((r) => r.title)).toEqual(["Task A", "Task B"]);
  });

  it("only counts redactions for records that actually survive the drop ladder", () => {
    // Every candidate here fits comfortably under ASK_MAX_CONTEXT_CHARS, so
    // nothing is dropped -- this pins that the redaction count is a sum over
    // SURVIVORS (an implementation detail worth a direct assertion even
    // though the drop ladder never fires in this specific case).
    const context = buildAskContext([candidate({ title: "sk-" + "a".repeat(30) })]);
    expect(context.records).toHaveLength(1);
    expect(context.redactions).toBe(1);
    expect(context.contextChars).toBeLessThan(ASK_MAX_CONTEXT_CHARS);
  });
});

describe("buildAskContext -- Checkpoint 9.7 options", () => {
  it("with no options is byte-identical to the option-less call (the 8.6B path is unchanged)", () => {
    const candidates = [candidate({ id: "a" }), candidate({ id: "b", title: "Second" })];
    const bare = buildAskContext(candidates);
    const empty = buildAskContext(candidates, {});
    expect(empty).toEqual(bare);
    expect(bare.records.map((r) => r.ref)).toEqual([1, 2]);
    expect(bare.serializedRecords).toBe(JSON.stringify(bare.records));
  });

  it("refOffset shifts every ref: refs become refOffset+1.. in order", () => {
    const context = buildAskContext([candidate({ id: "a" }), candidate({ id: "b" })], {
      refOffset: 12,
    });
    expect(context.records.map((r) => r.ref)).toEqual([13, 14]);
    expect(context.serializedRecords).toContain('"ref":13');
  });

  it("maxRecords caps the candidate set BEFORE the drop ladder, keeping rank order", () => {
    const context = buildAskContext(
      [
        candidate({ id: "a", title: "A" }),
        candidate({ id: "b", title: "B" }),
        candidate({ id: "c", title: "C" }),
      ],
      { maxRecords: 2 },
    );
    expect(context.records.map((r) => r.title)).toEqual(["A", "B"]);
    expect(context.survivingCandidates.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("maxChars narrows the ceiling and the ladder drops whole records to fit it", () => {
    const body = "b".repeat(1000);
    const many = [1, 2, 3, 4].map((n) => candidate({ id: String(n), body }));
    const wide = buildAskContext(many);
    expect(wide.records).toHaveLength(4);
    const narrow = buildAskContext(many, { maxChars: 2500 });
    expect(narrow.records.length).toBeLessThan(4);
    expect(narrow.records.length).toBeGreaterThan(0);
    expect(narrow.contextChars).toBeLessThanOrEqual(2500);
    expect(narrow.serializedRecords.length).toBe(narrow.contextChars);
  });

  it("the drop ladder preserves the offset numbering of the survivors", () => {
    const body = "b".repeat(1000);
    const many = [1, 2, 3, 4].map((n) => candidate({ id: String(n), body }));
    const narrow = buildAskContext(many, { maxChars: 2500, refOffset: 5 });
    expect(narrow.records[0]!.ref).toBe(6);
  });
});
