import { NativeModule, requireNativeModule } from "expo";
import type { CaptureIntent, CaptureIntentEvents } from "./CaptureIntent.types";

declare class CaptureIntentModule extends NativeModule<CaptureIntentEvents> {
  /**
   * Returns the pending capture intent AND clears it, in one call.
   * Deliberately a consume rather than a getter: a launch intent is sticky on
   * the Activity and Android re-delivers it after process death and restore
   * from Recents, so a plain read would resubmit the same share every time.
   */
  consumePendingCaptureIntent(): CaptureIntent | null;
}

export default requireNativeModule<CaptureIntentModule>("CaptureIntent");
