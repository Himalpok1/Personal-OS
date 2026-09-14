import { describe, expect, it } from "vitest";
import { FieldLengthCounter, fieldLengthCounterLabel } from "./field-length-counter";

describe("fieldLengthCounterLabel", () => {
  it("stays hidden until the text is within the last tenth of its bound", () => {
    expect(fieldLengthCounterLabel(0, 4000)).toBeNull();
    expect(fieldLengthCounterLabel(3599, 4000)).toBeNull();
    expect(fieldLengthCounterLabel(3600, 4000)).toBe("3,600 / 4,000");
    expect(fieldLengthCounterLabel(4000, 4000)).toBe("4,000 / 4,000");
  });

  it("rounds the threshold up for a bound that does not divide evenly", () => {
    // 512 * 0.9 = 460.8 -> shown from 461.
    expect(fieldLengthCounterLabel(460, 512)).toBeNull();
    expect(fieldLengthCounterLabel(461, 512)).toBe("461 / 512");
  });

  it("formats with thousands separators and renders null for a nonsensical bound", () => {
    expect(fieldLengthCounterLabel(19_000, 20_000)).toBe("19,000 / 20,000");
    expect(fieldLengthCounterLabel(5, 0)).toBeNull();
  });
});

describe("FieldLengthCounter", () => {
  it("renders nothing under the threshold and one Text at it", () => {
    expect(FieldLengthCounter({ length: 10, maxLength: 512 })).toBeNull();
    const el = FieldLengthCounter({ length: 500, maxLength: 512, testID: "counter" }) as {
      props: { children: string; testID: string };
    };
    expect(el.props.testID).toBe("counter");
    expect(el.props.children).toBe("500 / 512");
  });

  it("is not a live region -- TalkBack must not announce every keystroke past 90 %", () => {
    const el = FieldLengthCounter({ length: 500, maxLength: 512 }) as {
      props: Record<string, unknown>;
    };
    expect(el.props.accessibilityLiveRegion).toBeUndefined();
    expect(el.props["aria-live"]).toBeUndefined();
  });
});
