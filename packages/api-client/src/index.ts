import {
  connectGmail,
  disconnectMailConnection,
  generateMailDigest,
  getCurrentMailDigest,
  getGmailAuthorizeUrl,
  getMailConnection,
  listMailConnections,
} from "./mail.js";
import { acknowledgeMonitorIncident, getMonitorOverview, listMonitorIncidents } from "./monitor.js";
import { HealthCheckResponseSchema, type HealthCheckResponse } from "@personal-os/schema";
import {
  connectCaldavCalendar,
  connectGoogleCalendar,
  disconnectCalendarConnection,
  listAvailableCalendars,
  listAvailableGoogleCalendars,
  listCalendarConnections,
  syncCalendarConnectionNow,
  updateCalendarConnectionCalendars,
} from "./calendar-connections.js";
import { capture } from "./capture.js";
import { fetchJson } from "./client.js";
import {
  getDevice,
  listDevices,
  registerDevice,
  revokeDevice,
  sendTestNotification,
  setPrimaryDevice,
  updateDevice,
  updateDevicePushToken,
} from "./devices.js";
import {
  archiveEvent,
  cancelEventOccurrence,
  createEvent,
  detachEvent,
  getEvent,
  linkEventToCalendar,
  linkEventToGoogleCalendar,
  listEvents,
  listEventsInRange,
  updateEvent,
} from "./events.js";
import {
  getHealthMetricSeries,
  getHealthSleepSessions,
  getHealthSummary,
  getHealthWorkoutSessions,
  listHealthConnections,
  listHealthMetricStreams,
  syncHealthConnectionNow,
} from "./health.js";
import { confirmInboxItem, getInboxItem, listInbox } from "./inbox.js";
import { archiveNote, createNote, getNote, listNotes, updateNote } from "./notes.js";
import { completeOccurrence, listOccurrences, skipOccurrence } from "./occurrences.js";
import {
  archiveProject,
  completeProject,
  createProject,
  getProject,
  getProjectDetail,
  getProjectSummaries,
  listProjects,
  pauseProject,
  reopenProject,
  resumeProject,
  unarchiveProject,
  updateProject,
} from "./projects.js";
import {
  completeReview,
  createReview,
  getDailyReviewContext,
  getLatestReview,
  getReview,
  getWeeklyReviewContext,
  listReviews,
  skipReview,
  updateReview,
} from "./reviews.js";
import { generateBrief, getCurrentBrief } from "./brief.js";
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
import { getAgenda } from "./agenda.js";
import { search } from "./search.js";
import { getExport } from "./export.js";
import { getToday } from "./today.js";
import { transcribe } from "./transcribe.js";

export { ApiClientError, type ZodLikeSchema } from "./client.js";
export type { TranscribeAudioFile } from "./transcribe.js";
export type {
  AvailableGoogleCalendarsResponse,
  CalendarConnection,
  CalendarConnectionCalendar,
  CalendarConnectionCalendarUpdate,
  ConnectGoogleCalendarRequest,
} from "./calendar-connections.js";
export type { DeviceListParams } from "./devices.js";
export type {
  Event,
  EventCancelOccurrence,
  EventCreate,
  EventDetach,
  EventGoogleCalendarLink,
  EventListParams,
  EventRangeItem,
  EventRangeQuery,
  EventRangeResponse,
  EventUpdate,
  LinkEventToGoogleCalendarRequest,
} from "./events.js";
export type {
  HealthAggregation,
  HealthConnection,
  HealthConnectionListResponse,
  HealthConnectionSummary,
  HealthFreshnessDetail,
  HealthMetricCapability,
  HealthMetricPoint,
  HealthMetricSeriesResponse,
  HealthMetricStream,
  HealthMetricStreamListResponse,
  HealthMetricTile,
  HealthSeriesParams,
  HealthSeriesQuery,
  HealthSessionRangeParams,
  HealthSessionRangeQuery,
  HealthSleepListResponse,
  HealthSleepSession,
  HealthSummaryResponse,
  HealthSyncQueuedResponse,
  HealthValueState,
  HealthWorkoutListResponse,
  HealthWorkoutSession,
} from "./health.js";
export type {
  ConnectGmailRequest,
  MailAuthorizeUrlResponse,
  MailConnection,
  MailConnectionListResponse,
  MailDisconnectResponse,
} from "./mail.js";
export type { InboxListParams } from "./inbox.js";
export type { NoteListParams } from "./notes.js";
export type {
  ProjectDetailResponse,
  ProjectListParams,
  ProjectSummaryItem,
  ProjectSummaryListResponse,
} from "./projects.js";
export type {
  Review,
  ReviewCreate,
  ReviewKind,
  ReviewListQuery,
  ReviewStatus,
  ReviewUpdate,
} from "./reviews.js";
export type { BriefContent, DailyBriefRecord } from "./brief.js";
export type { Task, TaskCreate, TaskListParams, TaskStatus, TaskUpdate } from "./tasks.js";
export type { TodayResponse } from "./today.js";
export type { AgendaParams, AgendaResponse } from "./agenda.js";
export type { MonitorIncidentListParams } from "./monitor.js";
export type { SearchParams, SearchResponse } from "./search.js";
export type { ExportResponse } from "./export.js";

// A flat method bag, not a nested tasks.list()/notes.list() namespace --
// matches the shape the original single health() method already had.
// Framework-agnostic throughout: no React/TanStack import anywhere in this
// package (see docs/ARCHITECTURE.md's packages/api-client description).
export function createApiClient(baseUrl: string) {
  return {
    health: (): Promise<HealthCheckResponse> =>
      fetchJson(baseUrl, "/health", HealthCheckResponseSchema),

    capture: capture.bind(null, baseUrl),
    transcribe: transcribe.bind(null, baseUrl),

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
    getProjectSummaries: getProjectSummaries.bind(null, baseUrl),
    getProjectDetail: getProjectDetail.bind(null, baseUrl),
    pauseProject: pauseProject.bind(null, baseUrl),
    resumeProject: resumeProject.bind(null, baseUrl),
    completeProject: completeProject.bind(null, baseUrl),
    reopenProject: reopenProject.bind(null, baseUrl),
    unarchiveProject: unarchiveProject.bind(null, baseUrl),

    listEvents: listEvents.bind(null, baseUrl),
    getEvent: getEvent.bind(null, baseUrl),
    createEvent: createEvent.bind(null, baseUrl),
    updateEvent: updateEvent.bind(null, baseUrl),
    archiveEvent: archiveEvent.bind(null, baseUrl),
    listEventsInRange: listEventsInRange.bind(null, baseUrl),
    detachEvent: detachEvent.bind(null, baseUrl),
    cancelEventOccurrence: cancelEventOccurrence.bind(null, baseUrl),
    linkEventToGoogleCalendar: linkEventToGoogleCalendar.bind(null, baseUrl),
    linkEventToCalendar: linkEventToCalendar.bind(null, baseUrl),

    getToday: getToday.bind(null, baseUrl),
    getAgenda: getAgenda.bind(null, baseUrl),

    search: search.bind(null, baseUrl),
    getExport: getExport.bind(null, baseUrl),

    listOccurrences: listOccurrences.bind(null, baseUrl),
    completeOccurrence: completeOccurrence.bind(null, baseUrl),
    skipOccurrence: skipOccurrence.bind(null, baseUrl),

    listReviews: listReviews.bind(null, baseUrl),
    getReview: getReview.bind(null, baseUrl),
    createReview: createReview.bind(null, baseUrl),
    updateReview: updateReview.bind(null, baseUrl),
    getLatestReview: getLatestReview.bind(null, baseUrl),
    generateBrief: generateBrief.bind(null, baseUrl),
    getCurrentBrief: getCurrentBrief.bind(null, baseUrl),
    completeReview: completeReview.bind(null, baseUrl),
    skipReview: skipReview.bind(null, baseUrl),
    getDailyReviewContext: getDailyReviewContext.bind(null, baseUrl),
    getWeeklyReviewContext: getWeeklyReviewContext.bind(null, baseUrl),

    // Phase 6 Checkpoint 6.4. Named getHealth*/listHealth* rather than
    // getSummary etc. because `health()` above is already the API's liveness
    // probe -- the same collision that made every route a /health-* sibling.
    getHealthSummary: getHealthSummary.bind(null, baseUrl),
    getHealthMetricSeries: getHealthMetricSeries.bind(null, baseUrl),
    getHealthSleepSessions: getHealthSleepSessions.bind(null, baseUrl),
    getHealthWorkoutSessions: getHealthWorkoutSessions.bind(null, baseUrl),
    listHealthConnections: listHealthConnections.bind(null, baseUrl),
    listHealthMetricStreams: listHealthMetricStreams.bind(null, baseUrl),
    syncHealthConnectionNow: syncHealthConnectionNow.bind(null, baseUrl),

    // Phase 7 Checkpoint 7.2 -- connection lifecycle only. No sync, message,
    // digest or monitoring method exists yet, deliberately: a client method
    // whose route does not exist is a contract nobody can honour.
    getGmailAuthorizeUrl: getGmailAuthorizeUrl.bind(null, baseUrl),
    connectGmail: connectGmail.bind(null, baseUrl),
    listMailConnections: listMailConnections.bind(null, baseUrl),
    getMailConnection: getMailConnection.bind(null, baseUrl),
    disconnectMailConnection: disconnectMailConnection.bind(null, baseUrl),
    getCurrentMailDigest: getCurrentMailDigest.bind(null, baseUrl),
    generateMailDigest: generateMailDigest.bind(null, baseUrl),
    getMonitorOverview: getMonitorOverview.bind(null, baseUrl),
    listMonitorIncidents: listMonitorIncidents.bind(null, baseUrl),
    acknowledgeMonitorIncident: acknowledgeMonitorIncident.bind(null, baseUrl),

    connectGoogleCalendar: connectGoogleCalendar.bind(null, baseUrl),
    connectCaldavCalendar: connectCaldavCalendar.bind(null, baseUrl),
    listCalendarConnections: listCalendarConnections.bind(null, baseUrl),
    listAvailableGoogleCalendars: listAvailableGoogleCalendars.bind(null, baseUrl),
    listAvailableCalendars: listAvailableCalendars.bind(null, baseUrl),
    updateCalendarConnectionCalendars: updateCalendarConnectionCalendars.bind(null, baseUrl),
    syncCalendarConnectionNow: syncCalendarConnectionNow.bind(null, baseUrl),
    disconnectCalendarConnection: disconnectCalendarConnection.bind(null, baseUrl),

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
    sendTestNotification: sendTestNotification.bind(null, baseUrl),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
