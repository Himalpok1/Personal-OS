import { describe, expect, it } from "vitest";
import { canonicalNumeric, extractValue, jsonKindOf } from "./extract.js";
import type { HealthValueSpec } from "./value-spec.js";
import { getValueSpec } from "./value-spec.js";

describe("canonicalNumeric -- representation only, never precision", () => {
  it("preserves integers exactly", () => {
    expect(canonicalNumeric("8123")).toBe("8123");
    expect(canonicalNumeric(8123)).toBe("8123");
    expect(canonicalNumeric("0")).toBe("0");
  });

  // THE reason string space is used throughout: protobuf JSON encodes int64 as
  // a string precisely because these values are real, and Number() would
  // silently destroy them.
  it("preserves an int64 beyond Number.MAX_SAFE_INTEGER when given as a string", () => {
    const big = "9007199254740993"; // 2^53 + 1
    expect(canonicalNumeric(big)).toBe(big);
    expect(String(Number(big))).not.toBe(big); // proves the hazard is real
    expect(canonicalNumeric("123456789012345678901234567890")).toBe(
      "123456789012345678901234567890",
    );
  });

  it("normalizes numerically-equal decimals identically", () => {
    expect(canonicalNumeric("1.50")).toBe("1.5");
    expect(canonicalNumeric(1.5)).toBe("1.5");
    expect(canonicalNumeric("+1.5")).toBe("1.5");
    expect(canonicalNumeric("1.5000")).toBe("1.5");
    expect(canonicalNumeric("1.5e0")).toBe("1.5");
    expect(canonicalNumeric("01.50")).toBe("1.5");
  });

  // The complement, and the one that matters: values that are NOT equal must
  // never merge. A rounding "canonicalizer" would collapse these.
  it("keeps values that are not numerically equal distinct", () => {
    expect(canonicalNumeric("1.5000000000000001")).not.toBe(canonicalNumeric("1.50"));
    expect(canonicalNumeric("1.0000000000000000001")).not.toBe("1");
    expect(canonicalNumeric("1.05")).toBe("1.05");
    expect(canonicalNumeric("1.05")).not.toBe(canonicalNumeric("1.5"));
  });

  // WHY THE TEST ABOVE USES STRINGS, AND WHY THAT IS THE WHOLE ARGUMENT FOR
  // OPERATING IN STRING SPACE:
  //
  // The JS *literal* 1.5000000000000001 is not representable as a double and
  // rounds to exactly 1.5 before any of our code runs. The precision is gone at
  // parse time -- nothing downstream can recover it, and no canonicalizer can be
  // blamed for losing it. The nearest literal that genuinely differs from 1.5 is
  // a full ulp away.
  //
  // A provider sending that value as a STRING keeps every digit, which is
  // exactly why canonicalNumeric never routes a string through Number().
  it("loses nothing that JS had not already lost at parse time", () => {
    // Parsed at runtime rather than written as a literal, because the literal
    // itself is what loses the precision -- which is the very point being made.
    expect(Number("1.5000000000000001")).toBe(1.5);
    expect(canonicalNumeric(1.5000000000000002)).not.toBe(canonicalNumeric(1.5));
    expect(canonicalNumeric("1.5000000000000001")).toBe("1.5000000000000001");
  });

  it("preserves long decimal precision rather than rounding to a double", () => {
    const precise = "58.123456789012345678";
    expect(canonicalNumeric(precise)).toBe(precise);
  });

  it("normalizes negative zero to zero", () => {
    expect(canonicalNumeric("-0")).toBe("0");
    expect(canonicalNumeric(-0)).toBe("0");
    expect(canonicalNumeric("-0.000")).toBe("0");
    expect(canonicalNumeric("0.0")).toBe("0");
  });

  it("keeps a real negative signed", () => {
    expect(canonicalNumeric("-0.35")).toBe("-0.35");
    expect(canonicalNumeric(-2)).toBe("-2");
  });

  it("expands exponent notation to plain decimal", () => {
    expect(canonicalNumeric("1e3")).toBe("1000");
    expect(canonicalNumeric("1.5e3")).toBe("1500");
    expect(canonicalNumeric("1e-3")).toBe("0.001");
    expect(canonicalNumeric("1.23e-5")).toBe("0.0000123");
    // JS stringifies these in exponent form; the same string path expands them.
    expect(canonicalNumeric(1e21)).toBe("1000000000000000000000");
    expect(canonicalNumeric(1e-7)).toBe("0.0000001");
  });

  it("trims surrounding whitespace on a string", () => {
    expect(canonicalNumeric("  42 ")).toBe("42");
  });

  it("returns null for anything non-numeric", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "  ",
      ".",
      "+",
      "e5",
      "abc",
      "12abc",
      "1,234",
      "0x1f",
      "Infinity",
      "NaN",
      NaN,
      Infinity,
      -Infinity,
      true,
      {},
      [],
      [1],
    ]) {
      expect(canonicalNumeric(bad)).toBeNull();
    }
  });

  // A corrupt or hostile payload must not make this allocate gigabytes.
  it("refuses an absurd exponent instead of expanding it", () => {
    expect(canonicalNumeric("1e999999999")).toBeNull();
    expect(canonicalNumeric("1e-999999999")).toBeNull();
  });
});

describe("jsonKindOf", () => {
  it("names the kind and never the value", () => {
    expect(jsonKindOf(null)).toBe("null");
    expect(jsonKindOf(undefined)).toBe("undefined");
    expect(jsonKindOf([])).toBe("array");
    expect(jsonKindOf({})).toBe("object");
    expect(jsonKindOf(1)).toBe("number");
    expect(jsonKindOf("secret")).toBe("string");
  });
});

const STEPS = getValueSpec("steps");
const KCAL = getValueSpec("total-calories");
const ZONES = getValueSpec("active-zone-minutes");

describe("extractValue -- validate, never guess", () => {
  it("reads an int64 leaf sent as a string", () => {
    const out = extractValue({ steps: { count: "8123" } }, STEPS);
    expect(out).toEqual({ ok: true, value: "8123", breakdown: null });
  });

  it("reads an int64 leaf sent as a whole number", () => {
    expect(extractValue({ steps: { count: 8123 } }, STEPS)).toMatchObject({
      ok: true,
      value: "8123",
    });
  });

  // ADR-047's structural distinction: a genuine recorded zero is a VALUE.
  it("reads a true zero as a value, not as an absence", () => {
    expect(extractValue({ steps: { count: 0 } }, STEPS)).toMatchObject({ ok: true, value: "0" });
    expect(extractValue({ steps: { count: "0" } }, STEPS)).toMatchObject({ ok: true, value: "0" });
  });

  it("reads a double leaf", () => {
    expect(extractValue({ totalCalories: { caloriesKcal: 2143.75 } }, KCAL)).toMatchObject({
      ok: true,
      value: "2143.75",
    });
  });

  it("rejects a fractional value on a leaf declared int64", () => {
    const out = extractValue({ steps: { count: 8123.5 } }, STEPS);
    expect(out).toEqual({
      ok: false,
      rejection: { code: "leaf_type_mismatch", keyPath: "steps.count", sawType: "number" },
    });
    expect(extractValue({ steps: { count: "8123.5" } }, STEPS)).toMatchObject({
      ok: false,
      rejection: { code: "leaf_type_mismatch" },
    });
  });

  it("accepts an integral value on a leaf declared double", () => {
    expect(extractValue({ totalCalories: { caloriesKcal: 2000 } }, KCAL)).toMatchObject({
      ok: true,
      value: "2000",
    });
  });

  it("rejects a missing container", () => {
    expect(extractValue({}, STEPS)).toEqual({
      ok: false,
      rejection: { code: "container_missing", keyPath: "steps", sawType: "undefined" },
    });
    expect(extractValue({ steps: null }, STEPS)).toMatchObject({
      ok: false,
      rejection: { code: "container_missing", sawType: "null" },
    });
  });

  it("rejects a container that is not an object", () => {
    expect(extractValue({ steps: 8123 }, STEPS)).toMatchObject({
      ok: false,
      rejection: { code: "container_not_object", keyPath: "steps", sawType: "number" },
    });
    expect(extractValue({ steps: [] }, STEPS)).toMatchObject({
      ok: false,
      rejection: { code: "container_not_object", sawType: "array" },
    });
  });

  it("rejects a missing leaf rather than hunting for another number", () => {
    // `total` is a perfectly good-looking number. Nothing reaches for it.
    expect(extractValue({ steps: { total: 8123 } }, STEPS)).toEqual({
      ok: false,
      rejection: { code: "leaf_missing", keyPath: "steps.count", sawType: "undefined" },
    });
  });

  it("rejects a leaf of the wrong JSON kind", () => {
    for (const bad of [{}, [], true, "eight thousand"]) {
      expect(extractValue({ steps: { count: bad } }, STEPS)).toMatchObject({
        ok: false,
        rejection: { code: "leaf_type_mismatch", keyPath: "steps.count" },
      });
    }
  });

  it("never puts a value into a rejection", () => {
    const out = extractValue({ steps: { count: "SEKRET-VALUE" } }, STEPS);
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).not.toContain("SEKRET-VALUE");
    if (!out.ok) expect(Object.keys(out.rejection).sort()).toEqual(["code", "keyPath", "sawType"]);
  });

  it("supports a container that is itself the scalar", () => {
    const spec: HealthValueSpec = {
      container: "floors",
      leaf: null,
      leafType: "int64",
      breakdownLeaves: [],
    };
    expect(extractValue({ floors: "12" }, spec)).toMatchObject({ ok: true, value: "12" });
    expect(extractValue({ floors: {} }, spec)).toMatchObject({
      ok: false,
      rejection: { code: "container_type_mismatch" },
    });
  });
});

describe("breakdown is an allowlist, never a pass-through", () => {
  it("assembles only allowlisted leaves", () => {
    const out = extractValue(
      { activeZoneMinutes: { minutes: "42", fatBurnMinutes: "30", cardioMinutes: "12" } },
      ZONES,
    );
    expect(out).toMatchObject({
      ok: true,
      value: "42",
      breakdown: { fatBurnMinutes: "30", cardioMinutes: "12" },
    });
  });

  // The property that matters most: an unexpected provider field -- of ANY name
  // and any sensitivity -- cannot arrive in jsonb, because nothing is copied
  // except by name from the spec.
  it("drops an unexpected field even when it is named access_token", () => {
    const out = extractValue(
      {
        activeZoneMinutes: {
          minutes: "42",
          fatBurnMinutes: "30",
          access_token: "ya29.SHOULD-NEVER-BE-STORED",
          refresh_token: "1//SHOULD-NEVER-BE-STORED",
          nested: { client_secret: "SHOULD-NEVER-BE-STORED" },
        },
      },
      ZONES,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(Object.keys(out.breakdown as object)).toEqual(["fatBurnMinutes"]);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("refresh_token");
    expect(serialized).not.toContain("client_secret");
    expect(serialized).not.toContain("SHOULD-NEVER-BE-STORED");
  });

  it("also drops an unexpected field on a metric with no breakdown allowlist", () => {
    const out = extractValue({ steps: { count: "10", access_token: "ya29.NOPE" } }, STEPS);
    expect(out).toMatchObject({ ok: true, value: "10", breakdown: null });
    expect(JSON.stringify(out)).not.toContain("ya29");
  });

  it("omits an absent allowlisted leaf rather than rejecting the record", () => {
    const out = extractValue({ activeZoneMinutes: { minutes: "42" } }, ZONES);
    // A missing zone split must not cost the whole day's total.
    expect(out).toMatchObject({ ok: true, value: "42", breakdown: null });
  });

  it("rejects an allowlisted leaf that is present with the wrong type", () => {
    expect(
      extractValue({ activeZoneMinutes: { minutes: "42", peakMinutes: {} } }, ZONES),
    ).toMatchObject({
      ok: false,
      rejection: {
        code: "breakdown_leaf_type_mismatch",
        keyPath: "activeZoneMinutes.peakMinutes",
        sawType: "object",
      },
    });
  });

  it("canonicalizes breakdown leaves the same way as the value", () => {
    const out = extractValue({ activeZoneMinutes: { minutes: "42", cardioMinutes: 12 } }, ZONES);
    expect(out).toMatchObject({ ok: true, breakdown: { cardioMinutes: "12" } });
  });
});
