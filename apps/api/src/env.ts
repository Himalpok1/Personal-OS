import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
});

// Fail fast on missing config. This is distinct from DB *reachability*,
// which /health tolerates at runtime.
export const env = EnvSchema.parse(process.env);
