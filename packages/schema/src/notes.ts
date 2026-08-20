import { z } from "zod";
import { booleanQueryParam } from "./pagination.js";

export const NoteSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  project_id: z.string().uuid().nullable(),
  archived_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Note = z.infer<typeof NoteSchema>;

export const NoteCreateSchema = z
  .object({
    title: z.string().min(1),
    body: z.string().min(1),
    project_id: z.string().uuid().optional(),
  })
  .strict();
export type NoteCreate = z.infer<typeof NoteCreateSchema>;

export const NoteUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
    project_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });
export type NoteUpdate = z.infer<typeof NoteUpdateSchema>;

export const NoteListQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  include_archived: booleanQueryParam(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type NoteListQuery = z.infer<typeof NoteListQuerySchema>;
