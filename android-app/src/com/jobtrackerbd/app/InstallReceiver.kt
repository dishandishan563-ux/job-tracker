package com.jobtrackerbd.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.io.File

/**
 * Opens the system installer when the user taps the "update downloaded"
 * notification (v1.2.1). The notification tap is an explicit user action,
 * so launching the installer from here is allowed even when the app is
 * in the background.
 */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != UpdateDownloadService.ACTION_INSTALL) return
        val path = intent.getStringExtra(UpdateDownloadService.EXTRA_PATH) ?: return
        val file = File(path)
        if (!file.exists() || file.length() == 0L) return
        UpdateChecker.installApk(context, file)
    }
}
