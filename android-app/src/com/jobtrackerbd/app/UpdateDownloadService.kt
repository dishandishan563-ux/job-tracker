package com.jobtrackerbd.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Update download as a foreground service (v1.2.1).
 *
 * Why a service: the old in-activity thread died with MainActivity, so
 * leaving the app (or the screen turning off) silently killed the
 * download and the installer never opened — the update looked like it
 * never happened. A foreground service keeps downloading after the app
 * is left, shows a live progress notification, and on completion either
 * opens the installer itself (app open) or posts an install notification
 * (app closed — tapping it opens the installer).
 *
 * Honest limit: a sideloaded app can never install itself silently —
 * Android always asks the user to tap "Install" in the system installer.
 * This service gets as close as Android allows: download in the
 * background + one tap to install, wherever the user is.
 *
 * Progress is by parts: the APK ships as ~1.9 MB base64 parts
 * (see UpdateChecker) and parts are near-equal in size, so
 * (finished parts + current part fraction) / total parts is a fair %.
 */
class UpdateDownloadService : Service() {

    companion object {
        const val ACTION_PROGRESS = "com.jobtrackerbd.app.UPDATE_PROGRESS"
        const val ACTION_DONE = "com.jobtrackerbd.app.UPDATE_DONE"
        const val ACTION_FAILED = "com.jobtrackerbd.app.UPDATE_FAILED"
        const val ACTION_INSTALL = "com.jobtrackerbd.app.UPDATE_INSTALL"
        const val EXTRA_PERCENT = "percent"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_PATH = "path"

        private const val CHANNEL_ID = "jt_updates"
        private const val PROGRESS_NOTIF_ID = 2001
        const val INSTALL_NOTIF_ID = 2002

        /** True while MainActivity is resumed — the service auto-opens the
         * installer only then; otherwise it posts the install notification. */
        @Volatile var appForeground: Boolean = false
        @Volatile var downloading: Boolean = false

        fun start(context: Context) {
            val intent = Intent(context, UpdateDownloadService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                @Suppress("DEPRECATION")
                context.startService(intent)
            }
        }
    }

    private val manager by lazy {
        getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (downloading) return START_NOT_STICKY
        downloading = true
        createChannel()
        startForeground(PROGRESS_NOTIF_ID, progressNotification(0))
        thread { runDownload() }
        return START_NOT_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "অ্যাপ আপডেট (App Updates)",
                NotificationManager.IMPORTANCE_DEFAULT
            )
            manager.createNotificationChannel(channel)
        }
    }

    private fun builder(): Notification.Builder {
        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return b.setSmallIcon(R.mipmap.ic_launcher)
            .setOnlyAlertOnce(true)
    }

    private fun progressNotification(percent: Int): Notification {
        return builder()
            .setContentTitle("Job Tracker আপডেট ডাউনলোড হচ্ছে")
            .setContentText("ডাউনলোড হচ্ছে… $percent%")
            .setProgress(100, percent, false)
            .setOngoing(true)
            .build()
    }

    private fun runDownload() {
        var lastShown = -1
        try {
            val parts = UpdateChecker.fetchApkParts()
            val joined = StringBuilder()
            for (i in 1..parts) {
                val part = "%02d".format(i)
                val url = URL(Api.BASE + "/job-tracker.apk.b64.part" + part)
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 20000
                conn.readTimeout = 60000
                conn.setRequestProperty("Cache-Control", "no-store")
                try {
                    if (conn.responseCode != 200) throw Exception("HTTP ${conn.responseCode}")
                    val total = conn.contentLength // -1 if the server hides it
                    val out = ByteArrayOutputStream()
                    val buf = ByteArray(65536)
                    var read: Int
                    var done = 0L
                    val stream = conn.inputStream
                    while (stream.read(buf).also { read = it } != -1) {
                        out.write(buf, 0, read)
                        done += read
                        val frac = if (total > 0) done.toDouble() / total else 0.0
                        val pct = (((i - 1) + frac) / parts * 100).toInt().coerceIn(0, 100)
                        if (pct != lastShown) {
                            lastShown = pct
                            manager.notify(PROGRESS_NOTIF_ID, progressNotification(pct))
                            sendBroadcast(
                                Intent(ACTION_PROGRESS).putExtra(EXTRA_PERCENT, pct)
                            )
                        }
                    }
                    val text = String(out.toByteArray(), Charsets.UTF_8)
                    if (text.isBlank()) throw Exception("empty part $part")
                    joined.append(text.replace("\\s".toRegex(), ""))
                } finally {
                    conn.disconnect()
                }
            }
            if (joined.isEmpty()) throw Exception("empty download")
            val bytes = Base64.decode(joined.toString(), Base64.DEFAULT)
            if (bytes.isEmpty()) throw Exception("empty APK")
            val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?: throw Exception("storage unavailable")
            val file = File(dir, "job-tracker.apk")
            file.writeBytes(bytes)

            downloading = false
            stopForeground(true)
            sendBroadcast(Intent(ACTION_DONE).putExtra(EXTRA_PATH, file.absolutePath))
            if (appForeground) {
                UpdateChecker.installApk(this, file)
            } else {
                manager.notify(INSTALL_NOTIF_ID, installNotification(file))
            }
            stopSelf()
        } catch (e: Exception) {
            downloading = false
            stopForeground(true)
            val msg = "ডাউনলোড হয়নি — ইন্টারনেট দেখে আবার চাপুন।"
            sendBroadcast(Intent(ACTION_FAILED).putExtra(EXTRA_MESSAGE, msg))
            val openApp = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val pending = PendingIntent.getActivity(
                this, 0, openApp,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            manager.notify(
                INSTALL_NOTIF_ID,
                builder()
                    .setContentTitle("Job Tracker আপডেট")
                    .setContentText(msg)
                    .setStyle(Notification.BigTextStyle().bigText(msg))
                    .setAutoCancel(true)
                    .setContentIntent(pending)
                    .build()
            )
            stopSelf()
        }
    }

    private fun installNotification(file: File): Notification {
        val intent = Intent(this, InstallReceiver::class.java).apply {
            action = ACTION_INSTALL
            putExtra(EXTRA_PATH, file.absolutePath)
        }
        val pending = PendingIntent.getBroadcast(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return builder()
            .setContentTitle("Job Tracker আপডেট ডাউনলোড হয়েছে")
            .setContentText("ইনস্টল করতে চাপুন")
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
    }
}
