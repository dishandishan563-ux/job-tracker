package com.jobtrackerbd.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM push receiver (v1.1.7, CODE-READY ONLY — see PushHelper).
 *
 * The system only instantiates this service when a real push arrives,
 * which cannot happen until the Firebase console step is done and
 * google-services.json is in the app. Until then this class is never
 * loaded and the app runs exactly as before.
 *
 * - onNewToken: the device token changed (fresh install / reinstall) —
 *   save it to the server as top-level "pushToken" (or hold it in
 *   Store.pendingPushToken until the user logs in).
 * - onMessageReceived: show the push as a local notification, but only
 *   when the user's profile.pushEnabled is on. Tapping it opens the
 *   app home (MainActivity).
 */
class PushService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.i(TAG, "FCM token refreshed.")
        try {
            PushHelper.saveToken(applicationContext, token)
        } catch (e: Exception) {
            Log.w(TAG, "onNewToken save failed: ${e.message}")
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        try {
            Store.init(applicationContext)
            if (!Store.cachedData.profile.pushEnabled) return
            val title = message.notification?.title
                ?: message.data["title"]
                ?: "Job Tracker"
            val body = message.notification?.body
                ?: message.data["body"]
                ?: message.data["text"]
                ?: ""
            if (body.isBlank()) return
            showNotification(title, body)
        } catch (e: Exception) {
            Log.w(TAG, "onMessageReceived failed: ${e.message}")
        }
    }

    private fun showNotification(title: String, body: String) {
        val manager =
            getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "চাকরির রিমাইন্ডার (Job Reminders)",
                NotificationManager.IMPORTANCE_DEFAULT
            )
            manager.createNotificationChannel(channel)
        }
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pending = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // Framework Notification.Builder only — no androidx dependency.
        // Channel on Android 8+; on 7.x (minSdk 24) the builder works
        // without a channel.
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val notification = builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        manager.notify(NOTIFICATION_ID, notification)
    }

    companion object {
        private const val TAG = "PushService"
        private const val CHANNEL_ID = "jt_reminders"
        private const val NOTIFICATION_ID = 1001
    }
}
