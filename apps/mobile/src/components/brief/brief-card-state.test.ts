import { describe, expect, it } from "vitest";
import { resolveBriefCardState } from "./brief-card-state";

const brief = {
  content: { text: "You have 3 overdue tasks and a light afternoon." },
  generated_at: "2026-08-22T13:00:00Z",
};

const noProviderError = {
  status: 409,
  code: "no_provider_configured",
  body: { error: "no_provider_configured" },
};

describe("resolveBriefCardState", () => {
  it("is loading while the initial fetch is in flight, regardless of anything else", () => {
    expect(
      resolveBriefCardState({
        isLoading: true,
        brief: undefined,
        isGenerating: true,
        error: new Error("boom"),
      }),
    ).toEqual({ kind: "loading" });
  });

  it("is empty when there is no brief, no error, and nothing in flight", () => {
    expect(
      resolveBriefCardState({ isLoading: false, brief: null, isGenerating: false, error: null }),
    ).toEqual({ kind: "empty" });
  });

  it("is present when a brief exists and nothing is in flight", () => {
    expect(
      resolveBriefCardState({ isLoading: false, brief, isGenerating: false, error: null }),
    ).toEqual({
      kind: "present",
      text: brief.content.text,
      generatedAt: brief.generated_at,
    });
  });

  it("is generating, with no previous text, on a first-ever generation", () => {
    expect(
      resolveBriefCardState({ isLoading: false, brief: null, isGenerating: true, error: null }),
    ).toEqual({ kind: "generating", previousText: null });
  });

  it("is generating, carrying the previous brief's text forward, on a regeneration", () => {
    expect(
      resolveBriefCardState({ isLoading: false, brief, isGenerating: true, error: null }),
    ).toEqual({ kind: "generating", previousText: brief.content.text });
  });

  it("generating wins over an error left over from a prior failed attempt", () => {
    expect(
      resolveBriefCardState({
        isLoading: false,
        brief,
        isGenerating: true,
        error: new Error("stale failure"),
      }),
    ).toEqual({ kind: "generating", previousText: brief.content.text });
  });

  it("maps a 409 no_provider_configured error to the calm no_provider state, not error", () => {
    expect(
      resolveBriefCardState({
        isLoading: false,
        brief: null,
        isGenerating: false,
        error: noProviderError,
      }),
    ).toEqual({ kind: "no_provider", previousText: null });
  });

  it("no_provider preserves previousText from a still-cached brief", () => {
    expect(
      resolveBriefCardState({
        isLoading: false,
        brief,
        isGenerating: false,
        error: noProviderError,
      }),
    ).toEqual({ kind: "no_provider", previousText: brief.content.text });
  });

  it("treats a bare 409 with no code or body.error as no_provider too", () => {
    expect(
      resolveBriefCardState({
        isLoading: false,
        brief: null,
        isGenerating: false,
        error: { status: 409 },
      }),
    ).toEqual({ kind: "no_provider", previousText: null });
  });

  it("treats a 409 whose body.error is no_provider_configured (no top-level code) as no_provider", () => {
    expect(
      resolveBriefCardState({
        isLoading: false,
        brief: null,
        isGenerating: false,
        error: { status: 409, body: { error: "no_provider_configured" } },
      }),
    ).toEqual({ kind: "no_provider", previousText: null });
  });

  it("maps a 500 to the error state", () => {
    expect(
      resolveBriefCardState({
        isLoading: false,
        brief: null,
        isGenerating: false,
        error: { status: 500, code: "internal_error" },
      }),
    ).toEqual({ kind: "error", previousText: null });
  });

  it("maps a non-ApiClientError-shaped error (e.g. a network failure) to the error state", () => {
    expect(
      resolveBriefCardState({
        isLoading: false,
        brief: null,
        isGenerating: false,
        error: new TypeError("Network request failed"),
      }),
    ).toEqual({ kind: "error", previousText: null });
  });

  it("error preserves previousText from a still-cached brief -- a failed regeneration never destroys it", () => {
    expect(
      resolveBriefCardState({
        isLoading: false,
        brief,
        isGenerating: false,
        error: { status: 500, code: "internal_error" },
      }),
    ).toEqual({ kind: "error", previousText: brief.content.text });
  });

  it("a 409 with an unrelated code is still treated as error, not no_provider", () => {
    expect(
      resolveBriefCardState({
        isLoading: false,
        brief: null,
        isGenerating: false,
        error: { status: 409, code: "invalid_status_transition" },
      }),
    ).toEqual({ kind: "error", previousText: null });
  });
});
