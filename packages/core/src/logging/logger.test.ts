import { describe, expect, it } from "vitest";
import { buildLogRecord, errorToken, log, setLogSink, type LogLevel } from "./logger.js";

const AT = new Date("2026-09-01T12:00:00.000Z");

describe("buildLogRecord", () => {
  it("emits a timestamp, a level and the event name", () => {
    expect(buildLogRecord("info", "mail.sync.started", {}, AT)).toEqual({
      ts: "2026-09-01T12:00:00.000Z",
      level: "info",
      event: "mail.sync.started",
    });
  });

  it("passes uuids, counts, booleans, nulls and machine tokens through", () => {
    const record = buildLogRecord(
      "info",
      "mail.sync.finished",
      {
        connectionId: "6a51f2b6-3d0c-4a35-9a4f-3e0f5d6a7b8c",
        messages: 42,
        truncated: false,
        failureClass: null,
        kind: "incremental",
        at: "2026-09-01T12:00:00.000Z",
      },
      AT,
    );
    expect(record["connectionId"]).toBe("6a51f2b6-3d0c-4a35-9a4f-3e0f5d6a7b8c");
    expect(record["messages"]).toBe(42);
    expect(record["truncated"]).toBe(false);
    expect(record["failureClass"]).toBeNull();
    expect(record["kind"]).toBe("incremental");
    expect(record["at"]).toBe("2026-09-01T12:00:00.000Z");
  });

  it("drops a forbidden field by NAME whatever it holds", () => {
    const record = buildLogRecord(
      "info",
      "mail.sync.message",
      {
        subject: "Invoice",
        fromDisplayName: "Ada",
        accessToken: "ya29",
        cursorValue: "12345",
        rawPayload: "x",
      },
      AT,
    );
    // The NAME is the signal. "Invoice" would pass the value-shape filter --
    // a one-word subject is indistinguishable from a machine token -- so the
    // denylist is what actually stops it.
    for (const key of ["subject", "fromDisplayName", "accessToken", "cursorValue", "rawPayload"]) {
      expect(record[key]).toBe("[forbidden-field]");
    }
  });

  it("matches the denylist as a substring and case-insensitively", () => {
    const record = buildLogRecord(
      "info",
      "x.y",
      { MessageSubject: "a", refresh_token: "b", senderAddress: "c" },
      AT,
    );
    expect(record["MessageSubject"]).toBe("[forbidden-field]");
    expect(record["refresh_token"]).toBe("[forbidden-field]");
    expect(record["senderAddress"]).toBe("[forbidden-field]");
  });

  it("drops a memory statement by name (Checkpoint 10.7, ADR-077 §6)", () => {
    const record = buildLogRecord(
      "info",
      "memory.created",
      { statement: "evening", memoryStatement: "x", kind: "preference", count: 3 },
      AT,
    );
    expect(record["statement"]).toBe("[forbidden-field]");
    expect(record["memoryStatement"]).toBe("[forbidden-field]");
    expect(record["kind"]).toBe("preference");
    expect(record["count"]).toBe(3);
  });

  it("drops the Ask lane's own vocabulary by name (Checkpoint 8.6B)", () => {
    const record = buildLogRecord(
      "info",
      "ask.answered",
      { question: "what did I ask", prompt: "x", answer: "y" },
      AT,
    );
    for (const key of ["question", "prompt", "answer"]) {
      expect(record[key]).toBe("[forbidden-field]");
    }
  });

  it("does NOT shadow the Ask lane's own required counts-only fields", () => {
    // A collision an earlier draft of this denylist actually introduced:
    // "context" and "source" as fragments would have matched contextChars and
    // sourceCount too, silently breaking the exact fields design §9 requires
    // ai.usage to carry.
    const record = buildLogRecord(
      "info",
      "ai.usage",
      { sourceCount: 3, contextChars: 4200, redactionCount: 0 },
      AT,
    );
    expect(record["sourceCount"]).toBe(3);
    expect(record["contextChars"]).toBe(4200);
    expect(record["redactionCount"]).toBe(0);
  });

  it("redacts any string carrying whitespace, an @, quotes or angle brackets", () => {
    const record = buildLogRecord(
      "warn",
      "x.y",
      {
        note: "a subject line with spaces",
        who: "ada@example.com",
        header: null,
        quoted: '"Ada Lovelace"',
        angled: "<ada@example.com>",
      },
      AT,
    );
    expect(record["note"]).toBe("[redacted]");
    expect(record["who"]).toBe("[redacted]");
    expect(record["quoted"]).toBe("[redacted]");
    expect(record["angled"]).toBe("[redacted]");
  });

  it("redacts an over-long string whatever its shape", () => {
    expect(buildLogRecord("info", "x.y", { blob: "a".repeat(201) }, AT)["blob"]).toBe("[redacted]");
    expect(buildLogRecord("info", "x.y", { blob: "a".repeat(200) }, AT)["blob"]).toBe(
      "a".repeat(200),
    );
  });

  it("redacts a non-token event name, because a sentence is where prose hides", () => {
    expect(buildLogRecord("info", "sync failed for ada@example.com", {}, AT)["event"]).toBe(
      "[redacted]",
    );
  });

  it("omits undefined fields rather than emitting nulls for them", () => {
    const record = buildLogRecord("info", "x.y", { present: 1, absent: undefined }, AT);
    expect(record).not.toHaveProperty("absent");
    expect(record["present"]).toBe(1);
  });

  it("redacts a non-finite number", () => {
    expect(buildLogRecord("info", "x.y", { n: Number.NaN }, AT)["n"]).toBe("[redacted]");
    expect(buildLogRecord("info", "x.y", { n: Number.POSITIVE_INFINITY }, AT)["n"]).toBe(
      "[redacted]",
    );
  });
});

describe("errorToken", () => {
  it("prefers a SQLSTATE, which is what tells you a constraint fired", () => {
    expect(errorToken(Object.assign(new Error("boom"), { code: "23505" }))).toBe("23505");
    expect(errorToken(Object.assign(new Error("boom"), { code: "42501" }))).toBe("42501");
  });

  it("never returns a message, a stack, or a Postgres detail", () => {
    const err = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      detail: "Failing row contains (m1, Quarterly report, ada@example.com).",
      table: "mail_messages",
    });
    const token = errorToken(err);
    expect(token).toBe("23505");
    expect(token).not.toContain("Failing row");
    expect(token).not.toContain("ada@");
  });

  it("falls back to the error class name", () => {
    class GmailApiError extends Error {
      override name = "GmailApiError";
    }
    expect(errorToken(new GmailApiError("Gmail API 404 NOT_FOUND"))).toBe("GmailApiError");
  });

  it("returns unknown for a non-error throw or an unusable name", () => {
    expect(errorToken("a string")).toBe("unknown");
    expect(errorToken(null)).toBe("unknown");
    expect(errorToken(Object.assign(new Error("x"), { name: "has a space" }))).toBe("unknown");
    expect(errorToken(Object.assign(new Error("x"), { code: "not-a-sqlstate" }))).toBe("Error");
  });
});

describe("log", () => {
  it("writes one sanitized record per call at the right level", () => {
    const written: { level: LogLevel; record: Record<string, unknown> }[] = [];
    const restore = setLogSink({ write: (level, record) => written.push({ level, record }) });
    try {
      log.info("mail.sync.started", { connectionId: "abc" });
      log.warn("mail.sync.truncated", { messages: 500 });
      log.error("mail.sync.failed", { failureClass: "provider_error", subject: "leak me" });
    } finally {
      restore();
    }

    expect(written.map((w) => w.level)).toEqual(["info", "warn", "error"]);
    expect(written[0]!.record["event"]).toBe("mail.sync.started");
    expect(written[2]!.record["failureClass"]).toBe("provider_error");
    expect(written[2]!.record["subject"]).toBe("[forbidden-field]");
  });

  it("restores the previous sink, so one test cannot leak into the next", () => {
    const first: unknown[] = [];
    const restoreFirst = setLogSink({ write: (_l, r) => first.push(r) });
    const second: unknown[] = [];
    const restoreSecond = setLogSink({ write: (_l, r) => second.push(r) });
    log.info("a.b");
    restoreSecond();
    log.info("c.d");
    restoreFirst();

    expect(second).toHaveLength(1);
    expect(first).toHaveLength(1);
  });

  it("produces a record that survives JSON.stringify with nothing prose-shaped in it", () => {
    const written: Record<string, unknown>[] = [];
    const restore = setLogSink({ write: (_l, r) => written.push(r) });
    try {
      log.error("mail.sync.failed", {
        connectionId: "6a51f2b6-3d0c-4a35-9a4f-3e0f5d6a7b8c",
        error: errorToken(
          Object.assign(new Error('Unknown name "startHistoryId"'), { code: "23505" }),
        ),
      });
    } finally {
      restore();
    }
    const line = JSON.stringify(written[0]);
    expect(line).not.toContain("startHistoryId");
    expect(line).toContain("23505");
  });
});
