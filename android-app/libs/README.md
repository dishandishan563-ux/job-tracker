# Local-only libraries (NOT committed to GitHub)

`pdfbox-android-2.0.27.0.jar` (Apache PDFBox for Android, tom-roush,
based on PDFBox 2.0.27) and `../assets/` (its resource files: AFM,
glyphlist, CMaps, LiberationSans TTF) are **local-only** — the same as
the release keystore. They are binary, so the GitHub snapshot push
route (UTF-8 text only) cannot carry them, and `.gitignore` excludes
both `android-app/libs/*.jar` and `android-app/assets/`.

To re-fetch on a fresh machine:

    curl -O https://repo1.maven.org/maven2/com/tom-roush/pdfbox-android/2.0.27.0/pdfbox-android-2.0.27.0.aar
    unzip pdfbox-android-2.0.27.0.aar classes.jar -d /tmp/pdfbox-aar
    cp /tmp/pdfbox-aar/classes.jar android-app/libs/pdfbox-android-2.0.27.0.jar
    unzip pdfbox-android-2.0.27.0.aar 'assets/*' -d android-app/
    # (unzips to android-app/assets/...)

`build-apk.sh` fails with a clear message if the jar is missing.
The APK itself (shipped as job-tracker.apk.b64) contains the library
and the assets, so users never need these files.
