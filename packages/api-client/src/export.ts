import { ExportResponseSchema, type ExportResponse } from "@personal-os/schema";
import { fetchJson } from "./client.js";

export type { ExportResponse };

/**
 * Fetches the whole user-authored core.
 *
 * No params: the endpoint takes none, so there is no `ExportParams` interface
 * and no `buildQuery` call. The response is parsed through
 * `ExportResponseSchema` at this boundary like every other method here, so a
 * server that grew an unexpected field would fail loudly at the client rather
 * than pass it along.
 */
export async function getExport(baseUrl: string): Promise<ExportResponse> {
  return fetchJson(baseUrl, "/export", ExportResponseSchema);
}
