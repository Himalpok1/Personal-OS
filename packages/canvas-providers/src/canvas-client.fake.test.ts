import { describe, expect, it } from "vitest";
import { CanvasApiError } from "./canvas-client.js";
import { createFakeCanvasClient } from "./canvas-client.fake.js";

describe("FakeCanvasClient", () => {
  it("drains queued responses in FIFO order, per method", async () => {
    const fake = createFakeCanvasClient();
    fake.queueAssignments([{ id: 1, name: "HW1" }]);
    fake.queueAssignments([{ id: 2, name: "HW2" }]);

    const first = await fake.listAssignments("https://x.instructure.com", "tok", 100);
    const second = await fake.listAssignments("https://x.instructure.com", "tok", 100);

    expect(first[0]?.name).toBe("HW1");
    expect(second[0]?.name).toBe("HW2");
  });

  it("THROWS on an unqueued call rather than returning an empty page", async () => {
    // The load-bearing property, mirroring FakeMailClient: a fake that
    // returned [] here would give a GREEN test for code that made a call
    // nobody intended.
    const fake = createFakeCanvasClient();
    await expect(fake.listActiveCourses("https://x.instructure.com", "tok")).rejects.toThrow(
      /unexpected call to listActiveCourses\(\)/,
    );
  });

  it("throws once the queue is exhausted, even after successful calls", async () => {
    const fake = createFakeCanvasClient();
    fake.queueSelf({ id: 1, name: "Ada Lovelace" });
    await fake.getSelf("https://x.instructure.com", "tok");
    await expect(fake.getSelf("https://x.instructure.com", "tok")).rejects.toThrow(
      /unexpected call to getSelf\(\)/,
    );
  });

  it("keeps each method's queue independent", async () => {
    const fake = createFakeCanvasClient();
    fake.queueSelf({ id: 1, name: "Ada Lovelace" });
    // Queuing a self response must not satisfy a listActiveCourses call.
    await expect(fake.listActiveCourses("https://x.instructure.com", "tok")).rejects.toThrow(
      /listActiveCourses/,
    );
    await expect(fake.getSelf("https://x.instructure.com", "tok")).resolves.toMatchObject({
      name: "Ada Lovelace",
    });
  });

  it("propagates a scripted error by throwing it, not returning it", async () => {
    const fake = createFakeCanvasClient();
    const scripted = new CanvasApiError(429, "rate_limited");
    fake.queueAnnouncements(scripted);

    let caught: unknown;
    try {
      await fake.listAnnouncements("https://x.instructure.com", "tok", 1);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(scripted);
    expect((caught as CanvasApiError).code).toBe("rate_limited");
  });

  it("records every call, in order, with its arguments", async () => {
    const fake = createFakeCanvasClient();
    fake.queueSelf({ id: 1 });
    fake.queueAssignments([]);
    await fake.getSelf("https://x.instructure.com", "tok-a");
    await fake.listAssignments("https://x.instructure.com", "tok-a", 42);

    expect(fake.calls).toEqual([
      { method: "getSelf", baseUrl: "https://x.instructure.com", token: "tok-a" },
      {
        method: "listAssignments",
        baseUrl: "https://x.instructure.com",
        token: "tok-a",
        courseId: "42",
      },
    ]);
    expect(fake.callsFor("getSelf")).toHaveLength(1);
    expect(fake.callsFor("listAnnouncements")).toHaveLength(0);
  });

  it("reset() drops every queued response and every recorded call", async () => {
    const fake = createFakeCanvasClient();
    fake.queueSelf({ id: 1 });
    await fake.getSelf("https://x.instructure.com", "tok");
    fake.queueActiveCourses([]);

    fake.reset();

    expect(fake.calls).toHaveLength(0);
    expect(fake.pending()).toEqual({
      getSelf: 0,
      listActiveCourses: 0,
      listAssignments: 0,
      listAnnouncements: 0,
      listCalendarEvents: 0,
    });
    await expect(fake.listActiveCourses("https://x.instructure.com", "tok")).rejects.toThrow(
      /unexpected call/,
    );
  });
});
