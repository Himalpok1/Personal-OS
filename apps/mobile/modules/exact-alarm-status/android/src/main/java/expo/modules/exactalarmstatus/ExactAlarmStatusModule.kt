package expo.modules.exactalarmstatus

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExactAlarmStatusModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExactAlarmStatus")

    // Below API 31 (Android 12), SCHEDULE_EXACT_ALARM didn't exist as a
    // concept -- every app could always schedule exact alarms, so `true`
    // here is a correct answer, not a stand-in default.
    Function("canScheduleExactAlarms") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val alarmManager =
          appContext.reactContext?.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        alarmManager?.canScheduleExactAlarms() ?: false
      } else {
        true
      }
    }

    // There is no runtime permission-request dialog for
    // SCHEDULE_EXACT_ALARM -- the only path is this per-app system settings
    // screen, which the user must grant manually. No-op below API 31.
    Function("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        appContext.reactContext?.let { context ->
          val intent =
            Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
              data = Uri.parse("package:${context.packageName}")
              flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
          context.startActivity(intent)
        }
      }
    }
  }
}
