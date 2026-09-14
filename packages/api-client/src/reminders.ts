import {
  RemindersQuerySchema,
  RemindersResponseSchema,
  type RemindersQuery,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

// GET /reminders (Checkpoint 9.4): the server-derived list the primary
// device schedules local notifications from -- one item per one-off task
// with a reminder and one per open occurrence of a recurring task.
export async function listReminders(baseUrl: string, query: Partial<RemindersQuery> = {}) {
  const parsed = RemindersQuerySchema.parse(query);
  return fetchJson(baseUrl, `/reminders${buildQuery(parsed)}`, RemindersResponseSchema);
}
