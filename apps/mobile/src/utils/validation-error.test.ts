import { ApiClientError } from "@personal-os/api-client";
import {
  ENTITY_TITLE_MAX_CHARS,
  NOTE_BODY_MAX_CHARS,
  TaskCreateSchema,
  CaptureRequestSchema,
  tooLongMessage,
} from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { describeValidationError } from "./validation-error";

/** The raw ZodError the api-client's pre-request `parse` throws. */
function clientSideError(body: unknown, schema: { safeParse: (v: unknown) => unknown }): Error {
  const result = schema.safeParse(body) as { success: boolean; error?: Error };
  if (result.success || !result.error) throw new Error("expected the body to be refused");
  return result.error;
}

describe("describeValidationError", () => {
  it("returns the server's own too-long line for a 400 validation_failed with issues", () => {
    const error = new ApiClientError(400, "validation_failed", {
      error: "validation_failed",
      issues: [
        {
          code: "too_big",
          origin: "string",
          maximum: ENTITY_TITLE_MAX_CHARS,
          path: ["title"],
          message: tooLongMessage("title", ENTITY_TITLE_MAX_CHARS),
        },
      ],
    });
    expect(describeValidationError(error)).toBe("title must be at most 512 characters");
  });

  it("describes a client-side ZodError (too_big) from the api-client's pre-request parse", () => {
    const error = clientSideError(
      { title: "x".repeat(ENTITY_TITLE_MAX_CHARS + 1), timezone: "America/Chicago" },
      TaskCreateSchema,
    );
    expect(error.name).toBe("ZodError");
    expect(describeValidationError(error)).toBe("title must be at most 512 characters");
  });

  it("rebuilds the too-long line from `maximum` when a bound carries Zod's default message", () => {
    // CaptureRequestSchema.text is `.max(4000)` with no custom message.
    const error = clientSideError(
      {
        text: "x".repeat(4001),
        source: "web",
        client_uuid: "0b0b5f2a-9f7d-4a6e-9c3e-0d9e1c2b3a4f",
        captured_at: "2026-09-14T12:00:00Z",
        timezone: "America/Chicago",
      },
      CaptureRequestSchema,
    );
    expect(describeValidationError(error)).toBe("text must be at most 4000 characters");
  });

  it("names the field and says only that it isn't valid for any other issue", () => {
    const error = new ApiClientError(400, "validation_failed", {
      error: "validation_failed",
      issues: [{ code: "invalid_format", path: ["due_at"], message: "Invalid ISO datetime" }],
    });
    expect(describeValidationError(error)).toBe("due_at isn't valid");
    // A nested path is joined, so the field is still nameable.
    expect(
      describeValidationError(
        new ApiClientError(400, "validation_failed", {
          issues: [{ code: "invalid_type", path: ["calendar", "connection_id"], message: "x" }],
        }),
      ),
    ).toBe("calendar.connection_id isn't valid");
  });

  it("never echoes a typed value: only the field path and the bound reach the line", () => {
    const secret = "hunter2-" + "x".repeat(NOTE_BODY_MAX_CHARS);
    const error = new ApiClientError(400, "validation_failed", {
      issues: [
        {
          code: "too_big",
          origin: "string",
          maximum: NOTE_BODY_MAX_CHARS,
          path: ["body"],
          message: `Too big: ${secret}`,
          input: secret,
        },
      ],
    });
    const line = describeValidationError(error);
    expect(line).toBe("body must be at most 20000 characters");
    expect(line).not.toContain("hunter2");
  });

  it("falls back to a whole-form line when the issue list is empty or pathless", () => {
    expect(
      describeValidationError(new ApiClientError(400, "validation_failed", { issues: [] })),
    ).toBe("Something in the form isn't valid.");
    expect(
      describeValidationError(
        new ApiClientError(400, "validation_failed", { issues: [{ code: "custom", path: [] }] }),
      ),
    ).toBe("Something in the form isn't valid.");
  });

  it("returns null for everything that is not a validation failure", () => {
    expect(describeValidationError(new ApiClientError(404, "not_found"))).toBeNull();
    expect(describeValidationError(new ApiClientError(409, "event_not_owned"))).toBeNull();
    expect(describeValidationError(new ApiClientError(503, "job_queue_unavailable"))).toBeNull();
    expect(describeValidationError(new TypeError("Network request failed"))).toBeNull();
    expect(describeValidationError(undefined)).toBeNull();
    expect(describeValidationError({ issues: [] })).toBeNull();
  });
});
