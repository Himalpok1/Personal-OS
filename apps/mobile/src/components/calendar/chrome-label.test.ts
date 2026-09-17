import { describe, expect, it } from "vitest";
import { calendarChromeLabel } from "./chrome-label";

// Local-midnight dates, never `new Date("YYYY-MM-DD")` (UTC midnight), so the
// weekday math lands on the intended local calendar day.
const sep16 = new Date(2026, 8, 16); // a Wednesday
const sep30 = new Date(2026, 8, 30); // a Wednesday in the week that crosses into October
const dec30 = new Date(2026, 11, 30); // the week that crosses into 2027

describe("calendarChromeLabel (Checkpoint 10.6)", () => {
  it("keeps the full month form on a wide window and abbreviates it when compact", () => {
    expect(calendarChromeLabel("month", sep16, false)).toBe("September 2026");
    expect(calendarChromeLabel("month", sep16, true)).toBe("Sep 2026");
  });

  it("keeps the week form the tab has always shown on a wide window", () => {
    expect(calendarChromeLabel("week", sep16, false)).toBe("Sep 13 - Sep 19, 2026");
    expect(calendarChromeLabel("week", sep30, false)).toBe("Sep 27 - Oct 3, 2026");
  });

  it("compacts a week within one month to a day range", () => {
    expect(calendarChromeLabel("week", sep16, true)).toBe("Sep 13–19");
  });

  it("compacts a week that crosses a month by naming both months", () => {
    expect(calendarChromeLabel("week", sep30, true)).toBe("Sep 27–Oct 3");
  });

  it("names both months across a year boundary too", () => {
    expect(calendarChromeLabel("week", dec30, true)).toBe("Dec 27–Jan 2");
    expect(calendarChromeLabel("week", dec30, false)).toBe("Dec 27 - Jan 2, 2027");
  });
});
