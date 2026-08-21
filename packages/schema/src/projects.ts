import { z } from "zod";
import { booleanQueryParam } from "./pagination.js";

// Literals defined here, not imported from core -- the wire vocabulary is a
// contract of this package (core may map to richer internal states).
export const PROJECT_STATUSES = ["active", "paused", "completed"] as const;
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: ProjectStatusSchema,
  goal: z.string().nullable(),
  color: z.string().nullable(),
  target_date: z.string().date().nullable(),
  completed_at: z.string().datetime({ offset: true }).nullable(),
  archived_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Project = z.infer<typeof ProjectSchema>;

// No `status` field -- lifecycle transitions happen via dedicated endpoints
// (Checkpoint 5.2), never through generic create/update.
export const ProjectCreateSchema = z
  .object({
    name: z.string().min(1),
    color: z.string().optional(),
    goal: z.string().optional(),
    target_date: z.string().date().optional(),
  })
  .strict();
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    color: z.string().nullable().optional(),
    goal: z.string().nullable().optional(),
    target_date: z.string().date().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;

export const ProjectListQuerySchema = z.object({
  include_archived: booleanQueryParam(false),
});
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;
