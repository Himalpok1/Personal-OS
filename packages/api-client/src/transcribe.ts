import {
  CaptureResponseSchema,
  TranscribeFieldsSchema,
  type CaptureResponse,
  type TranscribeFields,
} from "@personal-os/schema";
import { postMultipart } from "./client.js";

// Duck-typed rather than DOM's File/Blob -- React Native's FormData accepts
// {uri, name, type} objects directly (its own extension, not a web
// standard), and that's the only shape expo-audio's recorder output can
// produce without an extra file-read step. Framework-agnostic in the sense
// that matters for this package: no react-native import, just an interface
// shaped for how RN's fetch/FormData actually consume a local file.
export interface TranscribeAudioFile {
  uri: string;
  name: string;
  type: string;
}

export async function transcribe(
  baseUrl: string,
  file: TranscribeAudioFile,
  fields: TranscribeFields,
): Promise<CaptureResponse> {
  const parsed = TranscribeFieldsSchema.parse(fields);

  const form = new FormData();
  // @types/node's FormData.append accepts an unknown value -- React
  // Native's own FormData accepts a {uri, name, type} object at runtime
  // (see TranscribeAudioFile's doc comment), so no cast is needed here.
  form.append("audio", file, file.name);
  form.append("client_uuid", parsed.client_uuid);
  form.append("captured_at", parsed.captured_at);
  form.append("timezone", parsed.timezone);

  return postMultipart(baseUrl, "/transcribe", CaptureResponseSchema, form);
}
