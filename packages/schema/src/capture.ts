// Deep import, not the package barrel (`@personal-os/core`): the barrel's
// index.ts re-exports the recurrence module, which uses
// `createRequire(import.meta.url)` as a Node-only workaround for a
// rrule@2.8.1 CJS/ESM interop bug (see packages/core/src/recurrence).
// apps/mobile bundles this package transitively via packages/schema for
// web, and Metro pulls in whatever a barrel import statically reaches --
// `createRequire`/`import.meta.url` don't exist in a browser and crash the
// bundle at runtime. Importing only the specific submodule this file
// actually needs keeps rrule (and the Node-only workaround) out of the web
// bundle's graph entirely.
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";

// Matches the /capture contract in docs/ARCHITECTURE.md. text is capped to
// bound both cost and abuse surface against the user's own LLM provider bill
// -- a single-user tool still shouldn't let one accidental paste burn a
// budget.
export const CaptureSourceSchema = z.enum(["siri", "ptt", "web", "share", "assistant"]);

export const CaptureRequestSchema = z.object({
  text: z.string().min(1).max(4000),
  source: CaptureSourceSchema,
  client_uuid: z.string().uuid(),
  captured_at: z.string().datetime({ offset: true }),
  timezone: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
});

export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

export const CaptureResponseSchema = z.object({
  inbox_id: z.string().uuid(),
});

export type CaptureResponse = z.infer<typeof CaptureResponseSchema>;

// POST /transcribe's non-file multipart fields. source is deliberately
// absent -- the route hardcodes it to "ptt" server-side, never
// client-supplied (see apps/api/src/routes/transcribe.ts).
export const TranscribeFieldsSchema = z.object({
  client_uuid: z.string().uuid(),
  captured_at: z.string().datetime({ offset: true }),
  timezone: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
});

export type TranscribeFields = z.infer<typeof TranscribeFieldsSchema>;
