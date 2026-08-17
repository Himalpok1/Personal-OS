import { NativeModule, requireNativeModule } from "expo";

declare class ExactAlarmStatusModule extends NativeModule<Record<string, never>> {
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): void;
}

export default requireNativeModule<ExactAlarmStatusModule>("ExactAlarmStatus");
