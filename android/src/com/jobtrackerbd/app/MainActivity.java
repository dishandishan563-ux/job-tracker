package com.jobtrackerbd.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;

/**
 * Job Tracker Android app — a thin native wrapper (WebView) around the live
 * site https://job-tracker-official-68.vercel.app/. All content, login,
 * circulars and reminders come from the live site, so site updates reach
 * the app immediately without a new APK. A new APK is needed only when
 * this wrapper itself changes.
 *
 * Update flow: the site reads the installed version from this WebView's
 * User-Agent ("JobTrackerApp/x.y.z") and compares it with /version.json.
 * When a newer version exists, the site shows the update banner; tapping
 * "আপডেট করুন" downloads the new APK and installs it via PackageInstaller.
 */
public class MainActivity extends Activity {
    public static final String SITE_URL = "https://job-tracker-official-68.vercel.app/index.html";
    private static final String SITE_HOST = "job-tracker-official-68.vercel.app";
    private static final int FILE_CHOOSER_REQ = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setBuiltInZoomControls(false);
        // Installed version is reported to the site via User-Agent so the
        // site can show the update banner when a newer version exists.
        String ver = "1.0.0";
        try {
            ver = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) { /* keep default */ }
        s.setUserAgentString(s.getUserAgentString() + " JobTrackerApp/" + ver);

        webView.addJavascriptInterface(new AppBridge(), "JobTrackerApp");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            private boolean handleUrl(Uri uri) {
                String scheme = uri.getScheme();
                if (scheme != null && (scheme.equals("tel") || scheme.equals("mailto"))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception e) { /* ignore */ }
                    return true;
                }
                // Stay inside the app only for the Job Tracker site itself;
                // everything else (WhatsApp, Telegram, Teletalk portals...)
                // opens in the external browser.
                if (uri.getHost() != null && uri.getHost().endsWith(SITE_HOST)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) { /* ignore */ }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // CV / profile photo upload needs a file chooser inside the app.
            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQ);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this,
                            "ফাইল বাছার অ্যাপ পাওয়া যায়নি।", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        if (savedInstanceState == null) webView.loadUrl(SITE_URL);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQ || filePathCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                results = new Uri[n];
                for (int i = 0; i < n; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    /** Called from the site's JS: window.JobTrackerApp.downloadApk(base64). */
    private class AppBridge {
        @JavascriptInterface
        public void downloadApk(final String base64) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    installApk(base64);
                }
            });
        }
    }

    private void installApk(String base64) {
        // Android 8+: the user must allow "Install unknown apps" for this app.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(this,
                    "অজানা উৎস থেকে ইনস্টল চালু করুন, তারপর আবার আপডেট চাপুন।",
                    Toast.LENGTH_LONG).show();
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                startActivity(i);
            } catch (Exception e) { /* ignore */ }
            return;
        }
        final byte[] apkBytes;
        try {
            apkBytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (Exception e) {
            Toast.makeText(this, "APK ডিকোড হয়নি।", Toast.LENGTH_SHORT).show();
            return;
        }
        Toast.makeText(this, "আপডেট ইনস্টল হচ্ছে…", Toast.LENGTH_SHORT).show();
        new Thread(new Runnable() {
            @Override
            public void run() {
                PackageInstaller pi = getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params =
                        new PackageInstaller.SessionParams(
                                PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                int sessionId = -1;
                try {
                    sessionId = pi.createSession(params);
                    PackageInstaller.Session session = pi.openSession(sessionId);
                    OutputStream out = session.openWrite("job-tracker.apk", 0, -1);
                    out.write(apkBytes);
                    session.fsync(out);
                    out.close();
                    Intent result = new Intent(MainActivity.this, InstallResultReceiver.class);
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        flags |= PendingIntent.FLAG_IMMUTABLE;
                    }
                    PendingIntent pending = PendingIntent.getBroadcast(
                            MainActivity.this, sessionId, result, flags);
                    session.commit(pending.getIntentSender());
                    session.close();
                } catch (Exception e) {
                    if (sessionId >= 0) {
                        try {
                            pi.abandonSession(sessionId);
                        } catch (Exception ignored) { /* ignore */ }
                    }
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(MainActivity.this,
                                    "ইনস্টল শুরু হয়নি — আবার চাপুন।",
                                    Toast.LENGTH_LONG).show();
                        }
                    });
                }
            }
        }).start();
    }
}
