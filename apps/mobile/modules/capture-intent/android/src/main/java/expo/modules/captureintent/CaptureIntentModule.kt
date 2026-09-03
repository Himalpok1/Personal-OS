package expo.modules.captureintent

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * Receives the two Android launches that mean "capture something":
 * a text/plain share from the system share sheet, and the launcher shortcut.
 *
 * TWO delivery paths are required and neither is sufficient alone, because
 * MainActivity is `launchMode="singleTask"` (Expo's own base template, and
 * required by Expo's scheme handling -- it must not be changed):
 *
 *  - COLD start: `onCreate` runs with the intent as the launch intent, but JS
 *    is not attached yet, so no event listener exists. Recovered by the
 *    pull-based `consumePendingCaptureIntent()` once JS mounts.
 *  - WARM start: `onNewIntent` runs and `onCreate` does NOT. Delivered by the
 *    `onCaptureIntent` event.
 *
 * The warm path must use the Intent handed to `OnNewIntent`, never
 * `activity.intent`: React Native's ReactActivity.onNewIntent forwards to its
 * delegate but never calls `setIntent()`, so `activity.intent` keeps returning
 * the ORIGINAL launch intent for the Activity's whole life.
 */
class CaptureIntentModule : Module() {
  // One pending intent at a time, mirroring google-calendar-auth's single
  // `pendingPromise` slot. Always populated on both paths so an intent that
  // arrives while JS is momentarily unmounted is not lost -- the event is an
  // optimisation, this slot is the source of truth.
  private var pendingKind: String? = null
  private var pendingText: String? = null
  private var pendingId: String? = null

  override fun definition() = ModuleDefinition {
    Name("CaptureIntent")

    Events("onCaptureIntent")

    OnNewIntent { intent ->
      capture(intent)?.let { payload -> sendEvent("onCaptureIntent", payload) }
      // Neutering the warm intent is not needed for correctness (it is not
      // the sticky one) but costs nothing and keeps one rule: an observed
      // capture intent is consumed exactly once.
      neutralize(intent)
    }

    Function("consumePendingCaptureIntent") {
      // Cold start. The launching intent is STICKY: Android re-delivers it
      // verbatim to a recreated Activity after a config change this app does
      // not absorb, and after process death plus restore from Recents. So it
      // is not enough to read it -- it must be neutered here, or the same
      // share is offered again on the next restore.
      if (pendingId == null) {
        appContext.currentActivity?.intent?.let { launchIntent ->
          capture(launchIntent)
          neutralize(launchIntent)
        }
      }

      val kind = pendingKind
      val text = pendingText
      val id = pendingId
      pendingKind = null
      pendingText = null
      pendingId = null
      if (kind == null || text == null || id == null) {
        null
      } else {
        mapOf("kind" to kind, "text" to text, "id" to id)
      }
    }
  }

  /** Records a capture intent and mints its stable id. Ignores every other intent. */
  private fun capture(intent: Intent): Map<String, String>? {
    // OnNewIntent fires for EVERY incoming intent, not just ours.
    val payload =
      when {
        intent.action == ACTION_COMPOSE -> Pair("compose", "")
        intent.action == Intent.ACTION_SEND && intent.type == MIME_TEXT_PLAIN -> {
          val shared = intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
          if (shared == null) return null else Pair("share", shared)
        }
        else -> return null
      }

    val id = UUID.randomUUID().toString()
    pendingKind = payload.first
    pendingText = payload.second
    pendingId = id
    return mapOf("kind" to payload.first, "text" to payload.second, "id" to id)
  }

  /** Makes an already-observed intent stop looking like a capture intent. */
  private fun neutralize(intent: Intent) {
    intent.removeExtra(Intent.EXTRA_TEXT)
    intent.action = Intent.ACTION_MAIN
  }

  companion object {
    // Must match the action in plugins/withCaptureShortcut.ts.
    const val ACTION_COMPOSE = "com.himal.personalos.action.CAPTURE"
    const val MIME_TEXT_PLAIN = "text/plain"
  }
}
