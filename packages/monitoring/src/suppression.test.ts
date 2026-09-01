import { describe, expect, it } from "vitest";
import { isDueForCheck, suppressionReason, type SuppressionInput } from "./suppression.js";

// 2026-09-01T12:00Z is 07:00 in America/Chicago (CDT, UTC-5).
const NOW = new Date("2026-09-01T12:00:00.000Z");

function input(overrides: Partial<SuppressionInput> = {}): SuppressionInput {
  return {
    enabled: true,
    mutedUntil: null,
    maintenanceStart: null,
    maintenanceEnd: null,
    maintenanceTimezone: null,
    ...overrides,
  };
}

describe("suppressionReason", () => {
  it("returns null for an ordinary enabled target", () => {
    expect(suppressionReason(input(), NOW)).toBeNull();
  });

  it("suppresses a disabled target", () => {
    expect(suppressionReason(input({ enabled: false }), NOW)).toBe("disabled");
  });

  it("suppresses while muted and resumes once the mute expires", () => {
    const later = new Date(NOW.getTime() + 60_000);
    expect(suppressionReason(input({ mutedUntil: later }), NOW)).toBe("muted");

    const earlier = new Date(NOW.getTime() - 60_000);
    expect(suppressionReason(input({ mutedUntil: earlier }), NOW)).toBeNull();
  });

  it("treats a mute expiring exactly now as expired", () => {
    // Strictly-greater, so a mute set to "until 12:00" does not also suppress
    // the check AT 12:00 -- an off-by-one that would silently extend every
    // deploy window by one interval.
    expect(suppressionReason(input({ mutedUntil: NOW }), NOW)).toBeNull();
  });

  it("suppresses inside a recurring maintenance window", () => {
    // 06:00-08:00 America/Chicago; NOW is 07:00 there.
    const reason = suppressionReason(
      input({
        maintenanceStart: "06:00",
        maintenanceEnd: "08:00",
        maintenanceTimezone: "America/Chicago",
      }),
      NOW,
    );
    expect(reason).toBe("maintenance_window");
  });

  it("does not suppress outside the window", () => {
    const reason = suppressionReason(
      input({
        maintenanceStart: "01:00",
        maintenanceEnd: "02:00",
        maintenanceTimezone: "America/Chicago",
      }),
      NOW,
    );
    expect(reason).toBeNull();
  });

  it("handles an OVERNIGHT window, which is the half everyone gets wrong", () => {
    // 22:00-08:00 wraps midnight. This is exactly why the module reuses
    // isWithinQuietHours instead of computing a window itself.
    const inside = suppressionReason(
      input({
        maintenanceStart: "22:00",
        maintenanceEnd: "08:00",
        maintenanceTimezone: "America/Chicago",
      }),
      NOW,
    );
    expect(inside).toBe("maintenance_window");

    // 14:00 Chicago is outside 22:00-08:00.
    const outside = suppressionReason(
      input({
        maintenanceStart: "22:00",
        maintenanceEnd: "08:00",
        maintenanceTimezone: "America/Chicago",
      }),
      new Date("2026-09-01T19:00:00.000Z"),
    );
    expect(outside).toBeNull();
  });

  it("evaluates the window in the TARGET's zone, not the server's", () => {
    // The same instant, two zones: 07:00 in Chicago is 00:00 the next day in
    // Auckland. A window of 06:00-08:00 catches one and not the other.
    const chicago = suppressionReason(
      input({
        maintenanceStart: "06:00",
        maintenanceEnd: "08:00",
        maintenanceTimezone: "America/Chicago",
      }),
      NOW,
    );
    const auckland = suppressionReason(
      input({
        maintenanceStart: "06:00",
        maintenanceEnd: "08:00",
        maintenanceTimezone: "Pacific/Auckland",
      }),
      NOW,
    );
    expect(chicago).toBe("maintenance_window");
    expect(auckland).toBeNull();
  });

  it("orders reasons from most deliberate to most incidental", () => {
    // A target that is both disabled and inside its window reads as `disabled`,
    // because that is the fact an operator needs to see first.
    const reason = suppressionReason(
      input({
        enabled: false,
        mutedUntil: new Date(NOW.getTime() + 60_000),
        maintenanceStart: "06:00",
        maintenanceEnd: "08:00",
        maintenanceTimezone: "America/Chicago",
      }),
      NOW,
    );
    expect(reason).toBe("disabled");
  });

  it("treats a PARTIAL window as no window, and keeps monitoring", () => {
    // The database CHECK makes a partial triple unrepresentable, so reaching
    // this branch means a row built in a test or by a future writer. The safe
    // failure is to keep monitoring, never to silently stop.
    for (const partial of [
      { maintenanceStart: "06:00" },
      { maintenanceStart: "06:00", maintenanceEnd: "08:00" },
      { maintenanceEnd: "08:00", maintenanceTimezone: "America/Chicago" },
    ]) {
      expect(suppressionReason(input(partial), NOW)).toBeNull();
    }
  });
});

describe("isDueForCheck", () => {
  it("is always due when nothing has ever been checked", () => {
    expect(isDueForCheck(null, 300, NOW)).toBe(true);
  });

  it("is due once the interval has elapsed", () => {
    expect(isDueForCheck(new Date(NOW.getTime() - 300_000), 300, NOW)).toBe(true);
  });

  it("is not due well inside the interval", () => {
    expect(isDueForCheck(new Date(NOW.getTime() - 60_000), 300, NOW)).toBe(false);
  });

  it("tolerates a tick landing fractionally early", () => {
    // Without the tolerance a cron tick arriving a second early would defer a
    // five-minute check by a whole tick every time, and the effective interval
    // would drift away from what the operator configured.
    expect(isDueForCheck(new Date(NOW.getTime() - 299_500), 300, NOW)).toBe(true);
    expect(isDueForCheck(new Date(NOW.getTime() - 250_000), 300, NOW)).toBe(false);
  });
});
