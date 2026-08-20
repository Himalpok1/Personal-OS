import type { GoogleCalendarAuthorizeResult } from "./GoogleCalendarAuth.types";

// Android-only for this spike (Locked Decision: the native AuthorizationClient
// flow is Android-specific). Web/iOS are out of scope for Checkpoint 4.5 Stage A.
export default {
  async authorize(): Promise<GoogleCalendarAuthorizeResult> {
    throw new Error("GoogleCalendarAuth.authorize() is not implemented on this platform");
  },
};
