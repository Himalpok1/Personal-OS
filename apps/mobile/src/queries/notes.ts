import type { NoteListParams } from "@personal-os/api-client";
import type { NoteCreate, NoteUpdate } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

const notesKey = (params: NoteListParams = {}) => ["notes", params] as const;
const noteKey = (id: string) => ["notes", id] as const;

export function useNotes(params: NoteListParams = {}) {
  return useQuery({
    queryKey: notesKey(params),
    queryFn: () => api.listNotes(params),
  });
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: noteKey(id ?? ""),
    queryFn: () => api.getNote(id!),
    enabled: id !== undefined,
  });
}

function useInvalidateNotes() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["notes"] });
}

export function useCreateNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (body: NoteCreate) => api.createNote(body),
    onSuccess: invalidate,
  });
}

export function useUpdateNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: NoteUpdate }) => api.updateNote(id, body),
    onSuccess: invalidate,
  });
}

export function useArchiveNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (id: string) => api.archiveNote(id),
    onSuccess: invalidate,
  });
}
