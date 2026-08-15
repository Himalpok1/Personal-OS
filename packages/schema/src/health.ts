import { z } from "zod";

export const HealthCheckResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  db: z.enum(["connected", "unreachable"]),
  worker: z.object({
    lastBeatAt: z.string().datetime().nullable(),
    stale: z.boolean(),
  }),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;
