// Re-export the native module. On web/iOS, it resolves to
// GoogleCalendarAuthModule.web.ts (unimplemented — Android only for this spike).
export { default } from "./src/GoogleCalendarAuthModule";
export * from "./src/GoogleCalendarAuth.types";
