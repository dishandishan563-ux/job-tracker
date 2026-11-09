package com.jobtrackerbd.app

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

/**
 * Push notifications (FCM) — v1.1.7, CODE-READY ONLY.
 *
 * The app has NO google-services.json yet (no Firebase project has been
 * created for it), so FCM is DORMANT: [isFcmConfigured] is false, no
 * Firebase call is ever made, and the app runs exactly as before.
 * Nothing here crashes without the file — every Firebase call sits
 * behind the [isFcmConfigured] gate and a try/catch.
 *
 * When the Firebase console step is done (project + Android app
 * com.jobtrackerbd.app + SHA-1, google-services.json dropped into
 * android-app/), build-apk.sh generates the google_app_id values from
 * that file, the gate opens, [ensureInitialized] runs FirebaseApp
 * initialisation, and [syncToken] starts saving the device token to the
 * server as the TOP-LEVEL field "pushToken" via the existing
 * POST /api/user-data save path (see the shared contract in Api.kt).
 * The on/off flag is profile.pushEnabled (default true); the server
 * worker only sends to users whose flag is on.
 *
 * The FirebaseMessagingService subclass itself lives in PushService.kt
 * and is declared in the manifest — the system only ever instantiates
 * it when a real push arrives, which cannot happen while FCM is dormant.
 */
object PushHelper {
    private const val TAG = "PushHelper"
    private var initAttempted = false
    private var initOk = false

    /**
     * TEMPORARY DIAGNOSTIC (crash-locator build): the last Push/Firebase
     * error, if any — MainActivity shows it once on home so a screenshot
     * names the failing step. Remove together with the display code.
     */
    var lastError: String? = null
        private set

    fun clearLastError() { lastError = null }

    private fun recordError(step: String, t: Throwable) {
        lastError = "$step (${t.javaClass.simpleName}) — ${(t.message ?: "").take(100)}"
    }

    /** True only when the google-services values exist in the app
     * (generated from google-services.json by build-apk.sh, or by the
     * google-services Gradle plugin if the project ever moves to Gradle).
     * Without the file this is false and FCM stays fully dormant. */
    fun isFcmConfigured(context: Context): Boolean {
        return try {
            context.resources.getIdentifier("google_app_id", "string", context.packageName) != 0
        } catch (e: Exception) {
            false
        }
    }

    /** True after a successful FirebaseApp initialisation. */
    fun isFcmReady(): Boolean = initOk

    /**
     * Initialise Firebase once, only when the config exists. Returns true
     * when FCM can be used. Never throws: any failure (no config, no
     * network, bad json) just leaves FCM dormant.
     */
    fun ensureInitialized(context: Context): Boolean {
        if (initOk) return true
        if (initAttempted) return false
        initAttempted = true
        if (!isFcmConfigured(context)) {
            Log.i(TAG, "FCM dormant: no google-services config in the app yet.")
            return false
        }
        return try {
            FirebaseApp.initializeApp(context.applicationContext)
            initOk = true
            Log.i(TAG, "FirebaseApp initialised.")
            true
        } catch (e: Throwable) {
            recordError("Push init:", e)
            Log.w(TAG, "FirebaseApp init failed, FCM stays dormant: ${e.message}")
            false
        }
    }

    /** Fetch the current FCM token and save it to the server (top-level
     * "pushToken"). No-op when FCM is dormant, the user is logged out,
     * or push is switched off in their profile. */
    fun syncToken(context: Context) {
        try {
            Store.init(context)
            if (!ensureInitialized(context)) return
            if (!Store.isLoggedIn) return
            if (!Store.cachedData.profile.pushEnabled) return
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                try {
                    if (!task.isSuccessful) {
                        Log.w(TAG, "FCM token fetch failed: ${task.exception?.message}")
                        return@addOnCompleteListener
                    }
                    val token = task.result ?: return@addOnCompleteListener
                    saveToken(context, token)
                } catch (e: Throwable) {
                    recordError("Push token:", e)
                    Log.w(TAG, "FCM token save failed: ${e.message}")
                }
            }
        } catch (e: Throwable) {
            recordError("Push sync:", e)
            Log.w(TAG, "syncToken failed, FCM stays dormant: ${e.message}")
        }
    }

    /** Save one token to the server. If the user is not logged in yet the
     * token is kept in [Store.pendingPushToken] and flushed by
     * [flushPendingToken] right after login. */
    fun saveToken(context: Context, token: String) {
        if (token.isBlank()) return
        try {
            Store.init(context)
            if (!Store.isLoggedIn) {
                Store.pendingPushToken = token
                return
            }
            if (Store.cachedData.pushToken == token) return
            Api.updateUserData({ data -> data.pushToken = token })
        } catch (e: Exception) {
            Log.w(TAG, "saveToken failed: ${e.message}")
        }
    }

    /** After a login, send any token that arrived while logged out. */
    fun flushPendingToken(context: Context) {
        try {
            Store.init(context)
            val pending = Store.pendingPushToken
            if (pending.isBlank() || !Store.isLoggedIn) return
            Store.pendingPushToken = ""
            saveToken(context, pending)
        } catch (e: Throwable) {
            recordError("Push flush:", e)
            Log.w(TAG, "flushPendingToken failed: ${e.message}")
        }
    }

    /** Push on/off switch. Saves profile.pushEnabled to the server; when
     * switching off, also deletes the FCM token on the device (best
     * effort — a failed delete never blocks the switch). */
    fun setPushEnabled(context: Context, enabled: Boolean, cb: ((Boolean) -> Unit)? = null) {
        try {
            Store.init(context)
            Api.updateUserData({ data -> data.profile.pushEnabled = enabled }) { ok ->
                if (!enabled && ok && initOk) {
                    try {
                        FirebaseMessaging.getInstance().deleteToken()
                    } catch (e: Exception) {
                        Log.w(TAG, "FCM deleteToken failed: ${e.message}")
                    }
                }
                if (enabled && ok) syncToken(context)
                cb?.invoke(ok)
            }
        } catch (e: Exception) {
            Log.w(TAG, "setPushEnabled failed: ${e.message}")
            cb?.invoke(false)
        }
    }

    /** Android 13+: the system notification permission. False on older
     * Android (no runtime permission exists there). */
    fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return context.checkSelfPermission(
            android.Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }
}
