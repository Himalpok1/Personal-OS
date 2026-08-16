import { HealthCheckResponseSchema, type HealthCheckResponse } from "@personal-os/schema";
import { capture } from "./capture.js";
import { fetchJson } from "./client.js";
import {
  getDevice,
  listDevices,
  registerDevice,
  revokeDevice,
  setPrimaryDevice,
  updateDevice,
  updateDevicePushToken,
} from "./devices.js";
import { confirmInboxItem, getInboxItem, listInbox } from "./inbox.js";
import { archiveNote, createNote, getNote, listNotes, updateNote } from "./notes.js";
import { completeOccurrence, listOccurrences, skipOccurrence } from "./occurrences.js";
import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  updateProject,
} from "./projects.js";
import {
  activateTask,
  archiveTask,
  completeTask,
  createTask,
  dropTask,
  getTask,
  listTasks,
  updateTask,
} from "./tasks.js";

export { ApiClientError, type ZodLikeSchema } from "./client.js";
export type { DeviceListParams } from "./devices.js";
export type { InboxListParams } from "./inbox.js";
export type { NoteListParams } from "./notes.js";
export type { ProjectListParams } from "./projects.js";
export type { TaskListParams } from "./tasks.js";

// A flat method bag, not a nested tasks.list()/notes.list() namespace --
// matches the shape the original single health() method already had.
// Framework-agnostic throughout: no React/TanStack import anywhere in this
// package (see docs/ARCHITECTURE.md's packages/api-client description).
export function createApiClient(baseUrl: string) {
  return {
    health: (): Promise<HealthCheckResponse> =>
      fetchJson(baseUrl, "/health", HealthCheckResponseSchema),

    capture: capture.bind(null, baseUrl),

    listInbox: listInbox.bind(null, baseUrl),
    getInboxItem: getInboxItem.bind(null, baseUrl),
    confirmInboxItem: confirmInboxItem.bind(null, baseUrl),

    listTasks: listTasks.bind(null, baseUrl),
    getTask: getTask.bind(null, baseUrl),
    createTask: createTask.bind(null, baseUrl),
    updateTask: updateTask.bind(null, baseUrl),
    archiveTask: archiveTask.bind(null, baseUrl),
    activateTask: activateTask.bind(null, baseUrl),
    completeTask: completeTask.bind(null, baseUrl),
    dropTask: dropTask.bind(null, baseUrl),

    listNotes: listNotes.bind(null, baseUrl),
    getNote: getNote.bind(null, baseUrl),
    createNote: createNote.bind(null, baseUrl),
    updateNote: updateNote.bind(null, baseUrl),
    archiveNote: archiveNote.bind(null, baseUrl),

    listProjects: listProjects.bind(null, baseUrl),
    getProject: getProject.bind(null, baseUrl),
    createProject: createProject.bind(null, baseUrl),
    updateProject: updateProject.bind(null, baseUrl),
    archiveProject: archiveProject.bind(null, baseUrl),

    listOccurrences: listOccurrences.bind(null, baseUrl),
    completeOccurrence: completeOccurrence.bind(null, baseUrl),
    skipOccurrence: skipOccurrence.bind(null, baseUrl),

    // Unlike every other method above, these take a device bearer token as
    // their second argument (after baseUrl) -- registerDevice is the one
    // exception, since it's the unauthenticated bootstrap call that
    // produces the token in the first place.
    registerDevice: registerDevice.bind(null, baseUrl),
    listDevices: listDevices.bind(null, baseUrl),
    getDevice: getDevice.bind(null, baseUrl),
    updateDevice: updateDevice.bind(null, baseUrl),
    setPrimaryDevice: setPrimaryDevice.bind(null, baseUrl),
    updateDevicePushToken: updateDevicePushToken.bind(null, baseUrl),
    revokeDevice: revokeDevice.bind(null, baseUrl),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
