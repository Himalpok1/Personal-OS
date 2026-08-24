import { describe, expect, it } from "vitest";
import {
  contentHash,
  listedHeartRateKey,
  reconciledHeartRateKey,
  sessionKey,
  type HeartRateIdentityInput,
} from "./identity.js";

const HR: HeartRateIdentityInput = {
  physicalTime: "2026-08-24T13:05:00Z",
  utcOffsetSeconds: -18000,
  beatsPerMinute: 72,
  motionContext: "SEDENTARY",
  sensorLocation: "WRIST",
};

describe("reconciledHeartRateKey", () => {
  it("is deterministic across calls", () => {
    expect(reconciledHeartRateKey(HR).key).toBe(reconciledHeartRateKey({ ...HR }).key);
  });

  it("reports the derived source when no dataPointName is supplied", () => {
    expect(reconciledHeartRateKey(HR).source).toBe("reconcile_derived");
  });

  it("prefers a real resource name when the API supplies one", () => {
    const k = reconciledHeartRateKey({
      ...HR,
      dataPointName: "users/me/dataTypes/heart-rate/dataPoints/x",
    });
    expect(k.source).toBe("data_point_name");
  });

  it("treats an empty dataPointName as absent, not as a name", () => {
    expect(reconciledHeartRateKey({ ...HR, dataPointName: "" }).source).toBe("reconcile_derived");
  });

  // Two samples at the SAME instant differing only in value must not collapse:
  // with no stable identity we cannot tell a correction from a distinct sample,
  // so both are kept and de-duplicated at read time.
  it("distinguishes samples that differ only by bpm", () => {
    expect(reconciledHeartRateKey(HR).key).not.toBe(
      reconciledHeartRateKey({ ...HR, beatsPerMinute: 73 }).key,
    );
  });

  it("distinguishes samples that differ only by instant", () => {
    expect(reconciledHeartRateKey(HR).key).not.toBe(
      reconciledHeartRateKey({ ...HR, physicalTime: "2026-08-24T13:06:00Z" }).key,
    );
  });

  it("distinguishes samples that differ only by offset", () => {
    expect(reconciledHeartRateKey(HR).key).not.toBe(
      reconciledHeartRateKey({ ...HR, utcOffsetSeconds: 20700 }).key,
    );
  });

  it("distinguishes samples that differ only by motion context or sensor location", () => {
    expect(reconciledHeartRateKey(HR).key).not.toBe(
      reconciledHeartRateKey({ ...HR, motionContext: "ACTIVE" }).key,
    );
    expect(reconciledHeartRateKey(HR).key).not.toBe(
      reconciledHeartRateKey({ ...HR, sensorLocation: "CHEST" }).key,
    );
  });

  // 72 and 72.0 are the same JS number, so this is not a float-precision
  // hazard -- pinned so nobody "fixes" it by stringifying with a formatter.
  it("hashes 72 and 72.0 identically", () => {
    expect(reconciledHeartRateKey({ ...HR, beatsPerMinute: 72.0 }).key).toBe(
      reconciledHeartRateKey({ ...HR, beatsPerMinute: 72 }).key,
    );
  });

  // A field value must never be able to impersonate the delimiter.
  it("cannot be spoofed by a component containing separator-like text", () => {
    const a = reconciledHeartRateKey({ ...HR, motionContext: "A", sensorLocation: "B" });
    const b = reconciledHeartRateKey({ ...HR, motionContext: 'A":"B', sensorLocation: null });
    expect(a.key).not.toBe(b.key);
  });

  // An absent field must hold its POSITION, or every later component shifts.
  it("distinguishes a null field from a shifted one", () => {
    const a = reconciledHeartRateKey({ ...HR, motionContext: null, sensorLocation: "WRIST" });
    const b = reconciledHeartRateKey({ ...HR, motionContext: "WRIST", sensorLocation: null });
    expect(a.key).not.toBe(b.key);
  });
});

describe("listedHeartRateKey", () => {
  it("is versioned distinctly from the reconcile key", () => {
    expect(listedHeartRateKey(HR).key).not.toBe(reconciledHeartRateKey(HR).key);
  });

  // DataSource is descriptive, not an identifier -- but it does separate
  // samples that genuinely came from different KINDS of source.
  it("separates otherwise-identical samples from different source kinds", () => {
    const phone = listedHeartRateKey({ ...HR, deviceFormFactor: "PHONE" });
    const watch = listedHeartRateKey({ ...HR, deviceFormFactor: "WATCH" });
    expect(phone.key).not.toBe(watch.key);
  });

  it("reports list_derived when unnamed", () => {
    expect(listedHeartRateKey(HR).source).toBe("list_derived");
  });
});

describe("sessionKey", () => {
  const S = { metric: "sleep", startTime: "2026-08-23T22:41:00Z", endTime: "2026-08-24T06:52:00Z" };

  it("uses the resource name verbatim when present", () => {
    const k = sessionKey({ ...S, dataPointName: "users/me/dataTypes/sleep/dataPoints/abc" });
    expect(k.key).toBe("users/me/dataTypes/sleep/dataPoints/abc");
    expect(k.source).toBe("data_point_name");
  });

  it("falls back to a deterministic type+interval key", () => {
    expect(sessionKey(S).key).toBe(sessionKey({ ...S }).key);
    expect(sessionKey(S).source).toBe("list_derived");
  });

  it("separates sleep from exercise over the identical interval", () => {
    expect(sessionKey(S).key).not.toBe(sessionKey({ ...S, metric: "exercise" }).key);
  });

  // Unlike heart rate, the session key excludes the VALUE, so an upstream
  // correction updates in place rather than creating a duplicate.
  it("is unaffected by fields outside type and interval", () => {
    expect(sessionKey(S).key).toBe(sessionKey({ ...S }).key);
  });
});

describe("contentHash", () => {
  it("is stable across object key order", () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });

  it("is stable across nested key order", () => {
    expect(contentHash({ x: { a: 1, b: 2 } })).toBe(contentHash({ x: { b: 2, a: 1 } }));
  });

  it("changes when a value changes", () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });

  it("distinguishes a nested object from an array", () => {
    expect(contentHash({ a: ["x"] })).not.toBe(contentHash({ a: "x" }));
  });

  it("ignores undefined properties so an optional field does not churn the hash", () => {
    expect(contentHash({ a: 1, b: undefined })).toBe(contentHash({ a: 1 }));
  });

  it("distinguishes null from undefined", () => {
    expect(contentHash({ a: null })).not.toBe(contentHash({ a: undefined }));
  });
});
