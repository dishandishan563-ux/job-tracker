package com.jobtrackerbd.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.util.Base64
import android.widget.Toast
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * In-app update system — same rule as the website:
 * on every app start (and every 30 min while open) /version.json is checked.
 * When versionCode is newer, a big banner offers the update; the button
 * downloads the new APK (base64 from the site) and opens the installer.
 * No background push while the app is closed (that needs FCM — not built).
 */
object UpdateChecker {
    /** Version dismissed with ✕ this session — shown again next launch. */
    var dismissedVersionCode: Int = -1
    var downloading: Boolean = false

    fun check(activity: Activity, onNewVersion: (versionName: String, versionCode: Int) -> Unit, onUpToDate: (() -> Unit)? = null) {
        Api.fetchVersion { v ->
            if (activity.isFinishing) return@fetchVersion
            val code = v?.optInt("versionCode", 0) ?: 0
            val name = v?.optString("versionName", "") ?: ""
            if (code > Api.APP_VERSION_CODE && code != dismissedVersionCode) {
                onNewVersion(name, code)
            } else {
                onUpToDate?.invoke()
            }
        }
    }

    /** Download /job-tracker.apk.b64, decode, save, and open the installer. */
    fun downloadAndInstall(activity: Activity, onStatus: (String) -> Unit) {
        if (downloading) {
            onStatus("ডাউনলোড চলছে…")
            return
        }
        downloading = true
        onStatus("অ্যাপ ডাউনলোড হচ্ছে…")
        thread {
            try {
                val url = URL(Api.BASE + "/job-tracker.apk.b64")
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 20000
                conn.readTimeout = 60000
                conn.setRequestProperty("Cache-Control", "no-store")
                if (conn.responseCode != 200) throw Exception("HTTP ${conn.responseCode}")
                val b64 = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                    .replace("\\s".toRegex(), "")
                val bytes = Base64.decode(b64, Base64.DEFAULT)
                val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    ?: throw Exception("storage unavailable")
                val file = File(dir, "job-tracker.apk")
                file.writeBytes(bytes)
                activity.runOnUiThread {
                    downloading = false
                    onStatus("ডাউনলোড হয়েছে — ইনস্টল চাপুন।")
                    installApk(activity, file)
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    downloading = false
                    onStatus("ডাউনলোড হয়নি — ইন্টারনেট দেখে আবার চাপুন।")
                    Toast.makeText(activity, "ডাউনলোড হয়নি: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun installApk(activity: Activity, file: File) {
        try {
            val uri = Uri.parse(
                "content://com.jobtrackerbd.app.fileprovider/apk/${file.name}"
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(activity, "ইনস্টল খোলা যায়নি।", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(activity, "ইনস্টল খোলা যায়নি: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }
}
