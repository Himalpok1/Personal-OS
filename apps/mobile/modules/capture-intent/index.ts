// Re-export the native module. On web it resolves to CaptureIntentModule.web.ts
// and on native platforms to CaptureIntentModule.ts, matching the convention in
// ../exact-alarm-status and ../google-calendar-auth.
export { default } from "./src/CaptureIntentModule";
export * from "./src/CaptureIntent.types";
