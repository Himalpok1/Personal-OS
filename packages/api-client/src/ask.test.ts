import { afterEach, describe, expect, it, vi } from "vitest";
import { askCloud } from "./ask.js";
import { ApiClientError } from "./client.js";

// POST /ask (Checkpoint 8.6B, widened in 9.7). What this file pins is the
// BOUNDARY: exactly which keys leave the device, that the request is parsed
// locally before it is sent (so an impossible request never reaches the wire),
// and that a response carrying a field the contract forbids is a parse failure
// rather than a silently-accepted leak.

const BASE = "http://api.test";
const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";

const RESPONSE = {
  answer: "One task is due today: pay the rent.",
  sources: [{ ref: 1, type: "task", id: TASK_ID, title: "Pay the rent" }],
  redactions: 0,
  model_id: MODEL_ID,
};

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>): unknown {
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  return JSON.parse(init.body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("askCloud", () => {
  it("POSTs the question, scope and tz to /ask and returns the parsed answer", async () => {
    const fetchMock = stubFetch(RESPONSE);
    const result = await askCloud(BASE, {
      question: "What should I focus on today?",
      scope: "today",
      tz: "America/Chicago",
    });

    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${BASE}/ask`);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(sentBody(fetchMock)).toEqual({
      question: "What should I focus on today?",
      scope: "today",
      tz: "America/Chicago",
    });
    expect(result.answer).toBe(RESPONSE.answer);
    expect(result.sources[0]!.id).toBe(TASK_ID);
  });

  it("sends a question-only request UNCHANGED -- the 8.6B shape, no key invented", async () => {
    // What keeps a pre-9.7 server answering a client that has no tz to send:
    // neither `scope` nor `tz` is defaulted in.
    const fetchMock = stubFetch(RESPONSE);
    await askCloud(BASE, { question: "where did I put the warranty?" });

    expect(sentBody(fetchMock)).toEqual({ question: "where did I put the warranty?" });
  });

  it("never puts the question in the query string", async () => {
    const fetchMock = stubFetch(RESPONSE);
    await askCloud(BASE, { question: "What should I focus on today?", tz: "America/Chicago" });

    expect(String(fetchMock.mock.calls[0]![0])).not.toContain("?");
  });

  it("refuses an unknown timezone LOCALLY -- nothing is sent", async () => {
    const fetchMock = stubFetch(RESPONSE);
    await expect(
      askCloud(BASE, { question: "What should I focus on today?", tz: "Mars/Olympus" }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses `scope` without `tz` LOCALLY -- the request the server also rejects", async () => {
    // A scope without a zone would silently get the body-selecting path, the
    // opposite of what `scope: "today"` asks for.
    const fetchMock = stubFetch(RESPONSE);
    await expect(
      askCloud(BASE, { question: "What should I focus on today?", scope: "today" }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a too-short question locally, before any round trip", async () => {
    const fetchMock = stubFetch(RESPONSE);
    await expect(askCloud(BASE, { question: "hi" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server's error code as ApiClientError", async () => {
    stubFetch({ error: "cloud_ask_disabled" }, 409);
    await expect(
      askCloud(BASE, { question: "What should I focus on today?" }),
    ).rejects.toMatchObject({ name: "ApiClientError", status: 409, code: "cloud_ask_disabled" });
    stubFetch({ error: "ask_consent_outdated" }, 409);
    await expect(
      askCloud(BASE, { question: "What should I focus on today?" }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });

  it("fails at the boundary when a source carries a field the contract forbids", async () => {
    stubFetch({
      ...RESPONSE,
      sources: [{ ...RESPONSE.sources[0], body: "the note's whole text" }],
    });
    await expect(askCloud(BASE, { question: "What should I focus on today?" })).rejects.toThrow();
  });

  it("fails at the boundary when the response itself carries an extra key", async () => {
    stubFetch({ ...RESPONSE, prompt: "you are a helpful assistant" });
    await expect(askCloud(BASE, { question: "What should I focus on today?" })).rejects.toThrow();
  });
});
