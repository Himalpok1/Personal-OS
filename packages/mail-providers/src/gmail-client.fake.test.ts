import { describe, expect, it } from "vitest";
import { GmailApiError } from "./gmail-client.js";
import { createFakeMailClient, fakeMessage } from "./gmail-client.fake.js";

describe("FakeMailClient", () => {
  it("drains queued responses in FIFO order", async () => {
    const fake = createFakeMailClient();
    fake.queueListMessages({ messages: [{ id: "1", threadId: "t1" }], nextPageToken: "P2" });
    fake.queueListMessages({ messages: [{ id: "2", threadId: "t2" }] });

    const first = await fake.listMessages("tok", {});
    const second = await fake.listMessages("tok", { pageToken: "P2" });

    expect(first.messages?.[0]?.id).toBe("1");
    expect(first.nextPageToken).toBe("P2");
    expect(second.messages?.[0]?.id).toBe("2");
    expect(second.nextPageToken).toBeUndefined();
  });

  it("THROWS on an unqueued call rather than returning an empty page", async () => {
    // The load-bearing property. A fake that returned {} here would give a
    // GREEN test for code that made a call nobody intended -- which is the
    // difference between "we tested the loop" and "the loop silently ran twice
    // and we never knew".
    const fake = createFakeMailClient();
    await expect(fake.listMessages("tok", {})).rejects.toThrow(
      /unexpected call to listMessages\(\)/,
    );
  });

  it("throws once the queue is exhausted, even after successful calls", async () => {
    const fake = createFakeMailClient();
    fake.queueListHistory({ historyId: "9" });
    await fake.listHistory("tok", { startHistoryId: "1" });
    await expect(fake.listHistory("tok", { startHistoryId: "9" })).rejects.toThrow(
      /unexpected call to listHistory\(\)/,
    );
  });

  it("keeps each method's queue independent", async () => {
    const fake = createFakeMailClient();
    fake.queueProfile({ emailAddress: "a@b.com", historyId: "1" });
    // Queuing a profile must not satisfy a listMessages call.
    await expect(fake.listMessages("tok", {})).rejects.toThrow(/listMessages/);
    await expect(fake.getProfile("tok")).resolves.toMatchObject({ emailAddress: "a@b.com" });
  });

  it("propagates a scripted error by throwing it, not returning it", async () => {
    const fake = createFakeMailClient();
    const scripted = new GmailApiError(429, "RESOURCE_EXHAUSTED", [{ reason: "rateLimit" }], 30);
    fake.queueListHistory(scripted);

    let caught: unknown;
    try {
      await fake.listHistory("tok", { startHistoryId: "1" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(scripted);
    expect((caught as GmailApiError).retryAfterSeconds).toBe(30);
  });

  it("can script the cursor-expiry 404 a sync engine must handle", async () => {
    // ADR-053's first-class transition, scriptable without a network.
    const fake = createFakeMailClient();
    fake.queueListHistory(new GmailApiError(404, "NOT_FOUND", [{ reason: "notFound" }], null));
    await expect(fake.listHistory("tok", { startHistoryId: "stale" })).rejects.toSatisfy(
      (e: unknown) => e instanceof GmailApiError && e.isNotFound,
    );
  });

  it("records every call with the arguments it was given", async () => {
    const fake = createFakeMailClient();
    fake.queueListMessages({ messages: [] });
    fake.queueMessageMetadata(fakeMessage({ id: "m1", subject: "Hi" }));

    await fake.listMessages("tok-a", { labelIds: ["INBOX"], maxResults: 25 });
    await fake.getMessageMetadata("tok-b", { id: "m1", metadataHeaders: ["From"] });

    expect(fake.calls).toHaveLength(2);
    expect(fake.callsFor("listMessages")[0]).toMatchObject({
      accessToken: "tok-a",
      labelIds: ["INBOX"],
      maxResults: 25,
    });
    expect(fake.callsFor("getMessageMetadata")[0]).toMatchObject({
      accessToken: "tok-b",
      messageId: "m1",
      metadataHeaders: ["From"],
    });
  });

  it("omits absent optional arguments from the call record", async () => {
    const fake = createFakeMailClient();
    fake.queueListMessages({ messages: [] });
    await fake.listMessages("tok", {});
    const call = fake.callsFor("listMessages")[0]!;
    expect("labelIds" in call).toBe(false);
    expect("pageToken" in call).toBe(false);
  });

  it("reports pending queue depth so a test can assert full consumption", async () => {
    const fake = createFakeMailClient();
    fake.queueProfile({ emailAddress: "a@b.com", historyId: "1" });
    fake.queueProfile({ emailAddress: "c@d.com", historyId: "2" });
    expect(fake.pending().getProfile).toBe(2);
    await fake.getProfile("tok");
    expect(fake.pending().getProfile).toBe(1);
    await fake.getProfile("tok");
    expect(fake.pending()).toEqual({
      getProfile: 0,
      listMessages: 0,
      getMessageMetadata: 0,
      listHistory: 0,
    });
  });

  it("reset() drops queued responses AND recorded calls", async () => {
    // Guards the cross-test bleed this method exists for: a suite that builds
    // its app once shares one fake, so an unconsumed response would be drained
    // by the next test.
    const fake = createFakeMailClient();
    fake.queueProfile({ emailAddress: "a@b.com", historyId: "1" });
    fake.queueListMessages({ messages: [] });
    await fake.listMessages("tok", {});
    expect(fake.calls).toHaveLength(1);
    expect(fake.pending().getProfile).toBe(1);

    fake.reset();

    expect(fake.calls).toHaveLength(0);
    expect(fake.pending()).toEqual({
      getProfile: 0,
      listMessages: 0,
      getMessageMetadata: 0,
      listHistory: 0,
    });
    // And the stale profile is genuinely gone, not merely uncounted.
    await expect(fake.getProfile("tok")).rejects.toThrow(/unexpected call to getProfile/);
  });
});

describe("fakeMessage", () => {
  it("builds a metadata message with only the allowlisted headers", () => {
    const m = fakeMessage({
      id: "m1",
      from: "Sender <s@example.com>",
      subject: "Report",
      date: "Sun, 30 Aug 2026 09:15:00 +0000",
      labelIds: ["INBOX"],
      internalDate: "1788000000000",
      sizeEstimate: 2048,
    });
    expect(m.payload?.headers?.map((h) => h.name)).toEqual(["From", "Subject", "Date"]);
    expect(m.labelIds).toEqual(["INBOX"]);
    expect(m.sizeEstimate).toBe(2048);
    // Metadata only: there is no body, snippet or attachment field to set.
    expect("snippet" in m).toBe(false);
    expect("raw" in m).toBe(false);
  });

  it("defaults threadId to the message id", () => {
    expect(fakeMessage({ id: "m1" }).threadId).toBe("m1");
  });
});
