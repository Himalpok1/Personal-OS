export interface TranscriptionConnection {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

export interface TranscriptionAudio {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface TranscriptionResult {
  text: string;
  // Mean of verbose_json's per-segment avg_logprob, null if the response
  // carries no segments (some OpenAI-compatible servers omit them even
  // when response_format: "verbose_json" is requested). This is the
  // confidence signal capture-parse.ts's lowTranscriptionConfidence flag
  // is wired to once Checkpoint 4 wires PTT captures through it.
  avgLogprob: number | null;
  raw: unknown;
}

interface VerboseJsonResponse {
  text?: unknown;
  segments?: { avg_logprob?: unknown }[];
}

// Speaks the raw OpenAI-compatible multipart /audio/transcriptions
// contract directly -- see resolve-transcription-connection.ts for why
// this is a deliberately parallel client, not an extension of
// packages/ai-providers' chat-oriented LanguageModel abstraction. No
// custom retry logic here, matching capture-parse.ts's convention:
// pg-boss's job-level retry (see apps/worker/src/jobs/ptt-transcribe.ts)
// is the retry mechanism, not hand-rolled HTTP backoff.
export async function transcribeAudio(
  connection: TranscriptionConnection,
  audio: TranscriptionAudio,
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("file", new Blob([audio.buffer], { type: audio.mimeType }), audio.filename);
  form.append("model", connection.modelId);
  form.append("response_format", "verbose_json");

  const baseUrl = connection.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`transcription request failed: ${response.status} ${bodyText}`.trim());
  }

  const json = (await response.json()) as VerboseJsonResponse;
  if (typeof json.text !== "string") {
    throw new Error("transcription response missing a text field");
  }

  const logprobs = (json.segments ?? [])
    .map((segment) => segment.avg_logprob)
    .filter((value): value is number => typeof value === "number");
  const avgLogprob =
    logprobs.length > 0 ? logprobs.reduce((sum, value) => sum + value, 0) / logprobs.length : null;

  return { text: json.text, avgLogprob, raw: json };
}
