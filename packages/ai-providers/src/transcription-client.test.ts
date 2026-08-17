import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeAudio } from "./transcription-client.js";

const connection = {
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "sk-test",
  modelId: "whisper-large-v3-turbo",
};
const audio = {
  buffer: Buffer.from("fake-audio-bytes"),
  filename: "capture.m4a",
  mimeType: "audio/m4a",
};

describe("transcribeAudio", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts a multipart request with the file, model, and verbose_json format", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: "hello world" }), { status: 200 }));
    global.fetch = fetchMock;

    await transcribeAudio(connection, audio);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk-test");
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("model")).toBe("whisper-large-v3-turbo");
    expect(body.get("response_format")).toBe("verbose_json");
    const file = body.get("file") as File;
    expect(file.name).toBe("capture.m4a");
    expect(file.type).toBe("audio/m4a");
  });

  it("strips a trailing slash from baseUrl before appending the path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: "x" }), { status: 200 }));
    global.fetch = fetchMock;

    await transcribeAudio({ ...connection, baseUrl: "https://api.groq.com/openai/v1/" }, audio);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
  });

  it("returns the transcript text with a null avgLogprob when no segments are present", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ text: "no segments here" }), { status: 200 }),
      );

    const result = await transcribeAudio(connection, audio);
    expect(result.text).toBe("no segments here");
    expect(result.avgLogprob).toBeNull();
  });

  it("computes avgLogprob as the mean of each segment's avg_logprob", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          text: "call the insurance guy",
          segments: [{ avg_logprob: -0.2 }, { avg_logprob: -0.4 }, { avg_logprob: -0.3 }],
        }),
        { status: 200 },
      ),
    );

    const result = await transcribeAudio(connection, audio);
    expect(result.avgLogprob).toBeCloseTo(-0.3, 5);
  });

  it("throws on a non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(transcribeAudio(connection, audio)).rejects.toThrow(/429/);
  });

  it("throws if the response has no text field", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await expect(transcribeAudio(connection, audio)).rejects.toThrow(/missing a text field/);
  });
});
