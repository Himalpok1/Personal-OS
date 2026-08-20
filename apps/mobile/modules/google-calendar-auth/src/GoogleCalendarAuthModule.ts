import { NativeModule, requireNativeModule } from "expo";

import type { GoogleCalendarAuthorizeResult } from "./GoogleCalendarAuth.types";

declare class GoogleCalendarAuthModule extends NativeModule<Record<string, never>> {
  authorize(webClientId: string, scopes: string[]): Promise<GoogleCalendarAuthorizeResult>;
}

export default requireNativeModule<GoogleCalendarAuthModule>("GoogleCalendarAuth");
