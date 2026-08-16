import { z } from "zod";

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  color: z.string().nullable(),
  archived_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type Project = z.infer<typeof ProjectSchema>;

// No `status` field -- projects.status is left alone in Phase 2 (see
// packages/db/src/schema/projects.ts's comment on why it isn't given the
// same treatment as archived_at).
export const ProjectCreateSchema = z
  .object({
    name: z.string().min(1),
    color: z.string().optional(),
  })
  .strict();
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    color: z.string().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;

export const ProjectListQuerySchema = z.object({
  include_archived: z.coerce.boolean().default(false),
});
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;
