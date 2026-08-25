export {
  GoogleOAuthError,
  exchangeAuthCode,
  refreshAccessToken,
  type GoogleOAuthCredentials,
  type ExchangeAuthCodeParams,
  type ExchangedGoogleTokens,
  type RefreshAccessTokenParams,
  type RefreshedGoogleTokens,
} from "./google-oauth.js";

export {
  createGoogleCalendarClient,
  GoogleSyncTokenExpiredError,
  GoogleCalendarApiError,
  type GoogleCalendarClient,
  type GoogleCalendarEvent,
  type GoogleEventDateTime,
  type GoogleEventStatus,
  type GoogleEventWriteBody,
  type ListCalendarsResult,
  type ListEventsParams,
  type ListEventsResult,
} from "./google-calendar-client.js";

export {
  createFakeGoogleCalendarClient,
  FAKE_SYNC_TOKEN_EXPIRED,
  type FakeGoogleCalendarClient,
  type FakeListEventsResponse,
  type GoogleCalendarClientFixtures,
} from "./google-calendar-client.fake.js";

export {
  googleAllDayToLocal,
  localAllDayToGoogle,
  googleRecurrenceToLocal,
  googleExdateInstantToLocalDate,
  wouldCollideOnSameLocalDate,
  classifyGoogleEvent,
  mapGoogleEventToLocalUpsert,
  type LocalEventFields,
  type LocalMutationIntent,
  type GoogleRecurrenceTranslation,
} from "./translate.js";

export {
  CalDavError,
  createCalDavClient,
  type CalDavAuth,
  type CalDavCalendarInfo,
  type CalDavClient,
  type CalDavSyncResult,
} from "./caldav/caldav-client.js";

export {
  createFakeCalDavClient,
  type FakeCalDavCalendar,
  type FakeCalDavClient,
  type FakeCalDavResource,
} from "./caldav/caldav-client.fake.js";

export {
  parseVCalendarToMutationIntents,
  localEventToVCalendar,
  applyExceptionToVCalendar,
  type CalDavEventFields,
  type CalDavMutationIntent,
  type CalDavTranslateOptions,
} from "./caldav/translate.js";

export { validateCalDavUrl, isSameOrigin } from "./caldav/ssrf.js";

export {
  classifyCalendarProviderError,
  classifyStoredCalendarSyncError,
} from "./classify-error.js";
