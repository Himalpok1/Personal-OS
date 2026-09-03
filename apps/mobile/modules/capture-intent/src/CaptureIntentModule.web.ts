import { registerWebModule, NativeModule } from "expo";
import type { CaptureIntent, CaptureIntentEvents } from "./CaptureIntent.types";

// Neither the Android share sheet nor a launcher shortcut has a web
// equivalent. `null` is the correct answer here, not a placeholder: there is
// never a pending capture intent on web, so the hook simply does nothing.
// Same benign-no-op shape as ../../exact-alarm-status/src/ExactAlarmStatusModule.web.ts.
class CaptureIntentModule extends NativeModule<CaptureIntentEvents> {
  consumePendingCaptureIntent(): CaptureIntent | null {
    return null;
  }
}

export default registerWebModule(CaptureIntentModule, "CaptureIntentModule");
