import { registerWebModule, NativeModule } from "expo";

// Exact-alarm permission is an Android-only concept. The web target (and
// iOS, when this app eventually builds there) has no equivalent -- callers
// treat `true` as "no restriction applies here", matching how iOS/pre-31
// Android are also unrestricted.
class ExactAlarmStatusModule extends NativeModule<Record<string, never>> {
  canScheduleExactAlarms(): boolean {
    return true;
  }
  openExactAlarmSettings(): void {
    // No-op: there is nothing to deep-link to outside Android 12+.
  }
}

export default registerWebModule(ExactAlarmStatusModule, "ExactAlarmStatusModule");
