package com.jobtrackerbd.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.util.Base64
import android.widget.Toast
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * In-app update system — same rule as the website:
 * on every app start (and every 30 min while open) /version.json is checked.
 * When versionCode is newer, a big banner offers the update; the button
 * downloads the new APK (base64 parts from the site, joined in order)
 * and opens the installer.
 *
 * v1.2.1: the download itself moved to UpdateDownloadService (a foreground
 * service). The old code downloaded on a plain thread owned by MainActivity
 * — leaving the app killed the download, the installer never opened, and
 * nothing told the user. The service keeps downloading after the app is
 * left, shows a progress notification, and on completion either opens
 * the installer (app open) or posts an install notification (app closed).
 * Progress / done / failed also come back to MainActivity as broadcasts.
 *
 * Version comparison uses Api.installedVersionCode (the manifest version
 * from the build) — v1.2.0 compared against the hardcoded APP_VERSION_CODE
 * const, which was never bumped, so Settings kept showing 1.1.9 and the
 * banner never went away after updating.
 */
object UpdateChecker {
    /** Version dismissed with ✕ this session — shown again next launch. */
    var dismissedVersionCode: Int = -1

    fun check(activity: Activity, onNewVersion: (versionName: String, versionCode: Int) -> Unit, onUpToDate: (() -> Unit)? = null) {
        Api.fetchVersion { v ->
            if (activity.isFinishing) return@fetchVersion
            val code = v?.optInt("versionCode", 0) ?: 0
            val name = v?.optString("versionName", "") ?: ""
            if (code > Api.installedVersionCode(activity) && code != dismissedVersionCode) {
                onNewVersion(name, code)
            } else {
                onUpToDate?.invoke()
            }
        }
    }

    /** Start the background download (foreground service). Progress comes
     * back as broadcasts (UpdateDownloadService.ACTION_PROGRESS / DONE /
     * FAILED) — the caller only gets this immediate status line. */
    fun downloadAndInstall(activity: Activity, onStatus: (String) -> Unit) {
        if (UpdateDownloadService.downloading) {
            onStatus("ডাউনলোড চলছে…")
            return
        }
        UpdateDownloadService.start(activity)
        onStatus("ডাউনলোড শুরু হচ্ছে…")
    }

    /** Part count for the chunked APK, from /version.json (apkParts).
     * Any failure (offline, old version.json without the field) falls
     * back to 7 — the count build-apk.sh splits into. */
    fun fetchApkParts(): Int {
        return try {
            val conn = URL(Api.BASE + "/version.json").openConnection() as HttpURLConnection
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            conn.setRequestProperty("Cache-Control", "no-store")
            conn.connect()
            if (conn.responseCode != HttpURLConnection.HTTP_OK) return 7
            val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val n = org.json.JSONObject(text).optInt("apkParts", 7)
            if (n in 1..20) n else 7
        } catch (e: Exception) {
            7
        }
    }

    /** The APK downloaded by the service, if it is already on the phone
     * (e.g. it finished while the app was closed). Null otherwise. */
    fun downloadedApkFile(context: Context): File? {
        return try {
            val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return null
            val file = File(dir, "job-tracker.apk")
            if (file.exists() && file.length() > 0) file else null
        } catch (e: Exception) {
            null
        }
    }

    fun installApk(context: Context, file: File) {
        try {
            val uri = Uri.parse(
                "content://com.jobtrackerbd.app.fileprovider/apk/${file.name}"
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(context, "ইনস্টল খোলা যায়নি।", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(context, "ইনস্টল খোলা যায়নি: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }
}
