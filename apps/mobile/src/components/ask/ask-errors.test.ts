import { ApiClientError } from "@personal-os/api-client";
import { describe, expect, it } from "vitest";
import { askErrorMessage, isCloudAskDisabledError } from "./ask-errors";

// Every status/code pair `POST /ask` can return (Checkpoint 8.6B design's
// error taxonomy), each pinned to its required copy.

describe("askErrorMessage", () => {
  it("maps every closed POST /ask error code to its required copy", () => {
    expect(askErrorMessage(new ApiClientError(409, "cloud_ask_disabled"))).toBe(
      "Cloud Ask was turned off.",
    );
    expect(askErrorMessage(new ApiClientError(409, "no_provider_configured"))).toBe(
      "The configured AI provider is unavailable right now.",
    );
    expect(askErrorMessage(new ApiClientError(422, "no_relevant_context"))).toBe(
      "Nothing in your notes or tasks matched those words — try different ones.",
    );
    expect(askErrorMessage(new ApiClientError(429, "ask_in_flight"))).toBe(
      "Another Ask is already in progress — try again in a moment.",
    );
    expect(askErrorMessage(new ApiClientError(502, "ask_failed"))).toBe(
      "The AI provider request failed.",
    );
    expect(askErrorMessage(new ApiClientError(400, "validation_failed"))).toBe(
      "That question is too short or too long.",
    );
  });

  it("never implies nothing was sent for a timeout -- a request DID leave the device", () => {
    const message = askErrorMessage(new ApiClientError(504, "ask_timeout"));
    expect(message).toBe("The provider didn't respond in time.");
    expect(message.toLowerCase()).not.toContain("nothing was sent");
    expect(message.toLowerCase()).not.toContain("wasn't sent");
  });

  it("falls back to a generic message for an unrecognised code", () => {
    expect(askErrorMessage(new ApiClientError(500, "something_else"))).toBe(
      "Couldn't complete that Ask.",
    );
  });

  it("falls back to a generic message for a non-ApiClientError value, never echoing it", () => {
    expect(askErrorMessage(new Error("connect ECONNREFUSED 10.0.0.4:3000"))).toBe(
      "Couldn't complete that Ask.",
    );
    expect(askErrorMessage("a raw string")).toBe("Couldn't complete that Ask.");
    expect(askErrorMessage(null)).toBe("Couldn't complete that Ask.");
    expect(askErrorMessage(undefined)).toBe("Couldn't complete that Ask.");
  });

  it("never returns an empty string", () => {
    for (const error of [
      new ApiClientError(409, "cloud_ask_disabled"),
      new ApiClientError(500, "unknown"),
      null,
      undefined,
    ]) {
      expect(askErrorMessage(error).length).toBeGreaterThan(0);
    }
  });
});

describe("isCloudAskDisabledError", () => {
  it("is true only for the cloud_ask_disabled code", () => {
    expect(isCloudAskDisabledError(new ApiClientError(409, "cloud_ask_disabled"))).toBe(true);
  });

  it("is false for every other code, status, or value", () => {
    expect(isCloudAskDisabledError(new ApiClientError(409, "no_provider_configured"))).toBe(false);
    expect(isCloudAskDisabledError(new ApiClientError(504, "ask_timeout"))).toBe(false);
    expect(isCloudAskDisabledError(new Error("cloud_ask_disabled"))).toBe(false);
    expect(isCloudAskDisabledError(null)).toBe(false);
  });
});
