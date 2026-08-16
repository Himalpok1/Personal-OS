// Framework-agnostic: no React/TanStack import anywhere in this package.
// TanStack Query hooks that wrap these functions live exclusively in
// apps/mobile (see docs/ARCHITECTURE.md's packages/api-client description).

export interface ZodLikeSchema<T> {
  parse(input: unknown): T;
}

// Thrown on any non-2xx response. `issues` is populated for the server's
// 400 validation_failed shape; `body` always carries the full parsed JSON
// error payload so callers can read endpoint-specific fields too (e.g.
// POST /tasks/:id/complete's 409 occurrence_id).
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: unknown;
  readonly body: unknown;

  constructor(status: number, code: string, body?: unknown) {
    super(`API error ${status}: ${code}`);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.body = body;
    this.issues = body && typeof body === "object" && "issues" in body ? body.issues : undefined;
  }
}

export async function fetchJson<T>(
  baseUrl: string,
  path: string,
  schema: ZodLikeSchema<T>,
  init?: RequestInit,
): Promise<T> {
  // Only set Content-Type when there's actually a body -- the action
  // endpoints (archive/activate/complete/drop/etc.) send no body at all,
  // and Fastify's JSON parser correctly rejects "Content-Type:
  // application/json" paired with an empty body as a 400 (which the error
  // handler then reports, confusingly, since nothing in the request was
  // actually malformed -- the caller just shouldn't have claimed a JSON
  // body it didn't send).
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (init?.body !== undefined && headers["Content-Type"] === undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(new URL(path, baseUrl), { ...init, headers });

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const errorBody = body as { error?: string } | undefined;
    throw new ApiClientError(response.status, errorBody?.error ?? "unknown_error", body);
  }

  return schema.parse(body);
}

type QueryValue = string | number | boolean | readonly string[] | undefined;

// Generic rather than `Record<string, QueryValue>` so a plain params
// interface (TaskListParams etc., declared without an index signature) can
// be passed directly -- TS requires an explicit index signature for
// assignability to a Record-typed parameter otherwise.
//
// Omits undefined entries -- every list-query params type in this package
// has optional filter fields, and URLSearchParams would otherwise serialize
// them as the literal string "undefined". Arrays (e.g. a task status
// filter) are joined with commas, matching what the API's own query
// schemas expect on the wire.
export function buildQuery<T extends object>(params: T): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, QueryValue][]) {
    if (value === undefined) continue;
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
