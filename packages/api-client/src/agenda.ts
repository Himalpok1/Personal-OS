import { AgendaResponseSchema, type AgendaResponse } from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

export type { AgendaResponse };

export interface AgendaParams {
  tz: string;
  from: string;
  to: string;
  project_id?: string;
}

export async function getAgenda(baseUrl: string, params: AgendaParams): Promise<AgendaResponse> {
  return fetchJson(baseUrl, `/agenda${buildQuery(params)}`, AgendaResponseSchema);
}
