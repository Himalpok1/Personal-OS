// Fastify's `.inject()` response `.json()` is generic (`json<T = any>()`)
// but defaults to `any` -- these give test files a typed call site instead
// of letting `any` flow into every assertion (type-aware eslint flags
// exactly that as unsafe).

export interface Paginated<T> {
  items: T[];
  limit: number;
  offset: number;
  total: number;
}

export interface ErrorBody {
  error: string;
  issues?: unknown;
  occurrence_id?: string | null;
  status?: string;
}
