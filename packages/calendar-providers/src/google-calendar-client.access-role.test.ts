import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampGoogleCalendarAccessRole,
  createGoogleCalendarClient,
} from "./google-calendar-client.js";

// Fixer review, MINOR-4: `listCalendars` must clamp `accessRole` to the four
// documented values. A role this code does not understand is `undefined`,
// which every consumer treats as "not writable" -- never persisted verbatim.
describe("listCalendars accessRole clamp", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("clampGoogleCalendarAccessRole keeps the four known values and drops everything else", () => {
    expect(clampGoogleCalendarAccessRole("owner")).toBe("owner");
    expect(clampGoogleCalendarAccessRole("writer")).toBe("writer");
    expect(clampGoogleCalendarAccessRole("reader")).toBe("reader");
    expect(clampGoogleCalendarAccessRole("freeBusyReader")).toBe("freeBusyReader");
    expect(clampGoogleCalendarAccessRole("Owner")).toBeUndefined();
    expect(clampGoogleCalendarAccessRole("admin")).toBeUndefined();
    expect(clampGoogleCalendarAccessRole("")).toBeUndefined();
    expect(clampGoogleCalendarAccessRole(42)).toBeUndefined();
    expect(clampGoogleCalendarAccessRole(undefined)).toBeUndefined();
  });

  it("the real client returns undefined for an unrecognised accessRole and the value for a known one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              { id: "a", summary: "A", accessRole: "writer" },
              { id: "b", summary: "B", accessRole: "superuser" },
              { id: "c", summary: "C" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const client = createGoogleCalendarClient();
    const result = await client.listCalendars("token");
    expect(result.items.map((i) => i.accessRole)).toEqual(["writer", undefined, undefined]);
  });
});
