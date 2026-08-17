import {
  CaptureResponseSchema,
  TranscribeFieldsSchema,
  type CaptureResponse,
  type TranscribeFields,
} from "@personal-os/schema";
import { postMultipart } from "./client.js";

// Standard Blob keeps the client framework-agnostic. Expo SDK 57's fetch
// implementation deliberately rejects React Native's legacy {uri, name,
// type} FormData extension, while expo-file-system's File implements Blob
// (and supplies bytes() without first copying the recording into JS memory).
export type TranscribeAudioFile = Blob & { readonly name?: string };

export async function transcribe(
  baseUrl: string,
  file: TranscribeAudioFile,
  fields: TranscribeFields,
): Promise<CaptureResponse> {
  const parsed = TranscribeFieldsSchema.parse(fields);

  const form = new FormData();
  form.append("audio", file, file.name ?? "audio");
  form.append("client_uuid", parsed.client_uuid);
  form.append("captured_at", parsed.captured_at);
  form.append("timezone", parsed.timezone);

  return postMultipart(baseUrl, "/transcribe", CaptureResponseSchema, form);
}
