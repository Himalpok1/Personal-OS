import {
  CaptureRequestSchema,
  CaptureResponseSchema,
  type CaptureRequest,
  type CaptureResponse,
} from "@personal-os/schema";
import { fetchJson } from "./client.js";

export async function capture(baseUrl: string, request: CaptureRequest): Promise<CaptureResponse> {
  const body = CaptureRequestSchema.parse(request);
  return fetchJson(baseUrl, "/capture", CaptureResponseSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
