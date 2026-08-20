package expo.modules.googlecalendarauth

import android.content.IntentSender
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// This project's spike (Checkpoint 4.5 Stage A) deliberately uses Google's
// current Identity Services Authorization API (Identity.getAuthorizationClient +
// requestOfflineAccess) rather than the deprecated legacy GoogleSignIn SDK.
// There is no redirect URI or custom URI scheme involved: the result comes
// back through an on-device Activity result, never a browser tab.
private const val REQUEST_CODE_AUTHORIZE = 62381

class GoogleCalendarAuthModule : Module() {
  // A single in-flight authorization request at a time is all this spike
  // needs; a second concurrent call is rejected rather than silently
  // clobbering the first caller's promise.
  private var pendingPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("GoogleCalendarAuth")

    AsyncFunction("authorize") { webClientId: String, scopes: List<String>, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_NO_ACTIVITY", "No current activity to launch authorization from", null)
        return@AsyncFunction
      }
      if (pendingPromise != null) {
        promise.reject(
          "ERR_ALREADY_PENDING",
          "An authorization request is already in progress",
          null,
        )
        return@AsyncFunction
      }
      pendingPromise = promise

      val request =
        AuthorizationRequest.builder()
          .setRequestedScopes(scopes.map { Scope(it) })
          .requestOfflineAccess(webClientId)
          .build()

      Identity.getAuthorizationClient(activity)
        .authorize(request)
        .addOnSuccessListener { result: AuthorizationResult ->
          if (result.hasResolution()) {
            try {
              activity.startIntentSenderForResult(
                result.pendingIntent!!.intentSender,
                REQUEST_CODE_AUTHORIZE,
                null,
                0,
                0,
                0,
              )
            } catch (e: IntentSender.SendIntentException) {
              finishWithError("ERR_LAUNCH_FAILED", e.message, e)
            }
          } else {
            finishWithResult(result)
          }
        }
        .addOnFailureListener { e -> finishWithError("ERR_AUTHORIZE_FAILED", e.message, e) }
    }

    OnActivityResult { activity, payload ->
      if (payload.requestCode != REQUEST_CODE_AUTHORIZE) {
        return@OnActivityResult
      }
      if (pendingPromise == null) {
        return@OnActivityResult
      }
      try {
        val result =
          Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(payload.data)
        finishWithResult(result)
      } catch (e: ApiException) {
        finishWithError("ERR_AUTHORIZE_FAILED", e.message, e)
      }
    }
  }

  private fun finishWithResult(result: AuthorizationResult) {
    val promise = pendingPromise ?: return
    pendingPromise = null
    val serverAuthCode = result.serverAuthCode
    if (serverAuthCode == null) {
      // requestOfflineAccess is what makes serverAuthCode non-null; a null
      // value here means the request was built wrong, not a user-facing
      // auth failure, so it is reported distinctly rather than silently
      // resolving with a missing field.
      promise.reject(
        "ERR_NO_SERVER_AUTH_CODE",
        "AuthorizationResult had no serverAuthCode -- was requestOfflineAccess() set?",
        null,
      )
      return
    }
    promise.resolve(
      mapOf(
        "serverAuthCode" to serverAuthCode,
        "grantedScopes" to (result.grantedScopes?.map { it.toString() } ?: emptyList<String>()),
      ),
    )
  }

  private fun finishWithError(code: String, message: String?, cause: Throwable?) {
    val promise = pendingPromise ?: return
    pendingPromise = null
    promise.reject(code, message, cause)
  }
}
