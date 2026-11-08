package com.jobtrackerbd.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

/** Receives the PackageInstaller result after an in-app APK update. */
public class InstallResultReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
        String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_SUCCESS) {
            Toast.makeText(context, "আপডেট ইনস্টল হয়েছে।", Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(context,
                    "ইনস্টল হয়নি" + (msg != null ? ": " + msg : " — আবার চাপুন।"),
                    Toast.LENGTH_LONG).show();
        }
    }
}
