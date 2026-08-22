import { TodayResponseSchema, type TodayResponse } from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

export type { TodayResponse };

export async function getToday(baseUrl: string, tz: string): Promise<TodayResponse> {
  return fetchJson(baseUrl, `/today${buildQuery({ tz })}`, TodayResponseSchema);
}
