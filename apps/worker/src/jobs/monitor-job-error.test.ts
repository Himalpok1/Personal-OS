import { describe, expect, it } from "vitest";
import { MonitorJobError, withMonitorJobErrorContainment } from "./monitor-job-error.js";

// Containment for the monitoring lane.
//
// The stakes here are higher than for the other job lanes: a monitoring pass
// holds TARGET URLS, and a target URL is operator-supplied and may carry a token
// in its query string. pg-boss persists whatever a failing handler throws into
// `pgboss.job.output`, a durable table that is never pruned -- so an unwrapped
// throw writes a credential to disk permanently.

const SECRET_URL = "https://internal.example/health?token=SUPERSECRET";

describe("MonitorJobError", () => {
  it("destroys the original message, stack and every own property", async () => {
    const cause = Object.assign(new Error(`fetch failed for ${SECRET_URL}`), {
      // The exact shapes a real failure carries.
      url: SECRET_URL,
      config: { headers: { authorization: "Bearer ya29.SUPERSECRET" } },
      detail: "Failing row contains (...)",
    });

    const error = await withMonitorJobErrorContainment("monitor.run", () => {
      throw cause;
    })([]).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MonitorJobError);
    // Serialized the way pg-boss's serialize-error walks it: every own
    // enumerable property, plus the standard Error fields.
    const serialized = JSON.stringify({
      ...(error as MonitorJobError),
      message: (error as Error).message,
      stack: (error as Error).stack,
    });
    for (const forbidden of ["SUPERSECRET", "ya29.", "internal.example", "Failing row"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("does NOT retain `cause`", () => {
    // serialize-error special-cases `cause` rather than relying on
    // enumerability, so retaining it would walk the original payload -- URLs
    // included -- straight back into the job table.
    const error = new MonitorJobError("monitor.run", new Error(SECRET_URL));
    expect(error.cause).toBeUndefined();
  });

  it("echoes a SQLSTATE-shaped code and nothing else", () => {
    expect(new MonitorJobError("monitor.run", { code: "23505" }).sqlState).toBe("23505");
    expect(new MonitorJobError("monitor.run", { code: "23505" }).message).toBe(
      "monitor.run failed (23505)",
    );
  });

  it("drops a code that is not SQLSTATE-shaped", () => {
    // Node's fetch failures use string codes like ECONNREFUSED, and a provider
    // could return anything at all -- so the shape is the gate, not the source.
    for (const code of ["ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", SECRET_URL, "", "234567"]) {
      const error = new MonitorJobError("monitor.run", { code });
      expect(error.sqlState).toBeNull();
      expect(error.message).toBe("monitor.run failed");
    }
  });

  it("survives a non-object throw", () => {
    // A `throw "boom"` anywhere in the lane must not itself become the failure.
    expect(new MonitorJobError("monitor.run", "boom").sqlState).toBeNull();
    expect(new MonitorJobError("monitor.run", null).message).toBe("monitor.run failed");
  });
});

describe("withMonitorJobErrorContainment", () => {
  it("passes a successful handler straight through", async () => {
    const seen: number[] = [];
    const contained = withMonitorJobErrorContainment<number>("monitor.run", (jobs) => {
      seen.push(...jobs);
      return Promise.resolve();
    });

    await expect(contained([1, 2])).resolves.toBeUndefined();
    expect(seen).toEqual([1, 2]);
  });

  it("names the queue it wrapped", async () => {
    await expect(
      withMonitorJobErrorContainment("monitor.run", () => Promise.reject(new Error(SECRET_URL)))(
        [],
      ),
    ).rejects.toMatchObject({ queue: "monitor.run", name: "MonitorJobError" });
  });
});
