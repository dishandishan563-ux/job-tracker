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

# v1.1.7 vendored libraries (local-only, same as PdfBox above)
#
# This project has no Gradle: the Firebase / Play Services / tess-two
# AARs are vendored by hand (nearest-wins Maven resolution, pinned
# versions below) so the manual build-apk.sh can use them.
#
# - `libs/vendor/*.jar` — classes.jar from each AAR (57 jars), on the
#   kotlinc classpath and the R8 inputs. NOT committed (gitignored).
# - `libs/aar-res/<artifact>/` — each AAR's res/ (compiled by aapt2).
#   NOT committed (gitignored).
# - `libs/aar-jni/<abi>/*.so` — tess-two native libs. Only arm64-v8a is
#   packaged (v1.1.7 size fix: armeabi-v7a was dropped to fit the GitHub
#   push limit; x86/x86_64 are emulator-only. On a 32-bit device the app
#   still installs and runs, and OcrHelper reports image OCR unavailable
#   there with a Bengali message saying a 64-bit phone is needed; PDF
#   CVs still work). NOT committed (gitignored).
# - `assets/tessdata/eng.traineddata`, `ben.traineddata` — Tesseract
#   traineddata (tessdata_fast). NOT bundled in the APK any more (v1.1.7
#   size fix). They are delivered as base64 TEXT at the repo root
#   (`tessdata/eng.traineddata.b64`, `tessdata/ben.traineddata.b64`) —
#   binary files can never go through the GitHub snapshot push (UTF-8
#   only), so this is the same .b64 delivery the project already uses
#   for the APK itself (job-tracker.apk.b64). The live site serves them;
#   OcrHelper downloads them once on first OCR use, base64-decodes the
#   response, and saves the decoded bytes as tessdata/eng.traineddata /
#   ben.traineddata in the app's private files dir (cached — never
#   re-downloaded). Regenerate the .b64 files from the local copies here:
#
#     base64 android-app/assets/tessdata/eng.traineddata > tessdata/eng.traineddata.b64
#     base64 android-app/assets/tessdata/ben.traineddata > tessdata/ben.traineddata.b64
#
#   and verify the round-trip (decoding must reproduce the original
#   byte-identically):
#
#     base64 -d tessdata/eng.traineddata.b64 | sha256sum
#     sha256sum android-app/assets/tessdata/eng.traineddata
#
#   The local copies here are only the source for the repo-root .b64
#   files (build-apk.sh fails if either side is missing). NOT committed
#   (assets/ is gitignored). NEVER put the binary .traineddata files at
#   the repo root — the push rejects them ("not UTF-8").
#
# CHUNKED DELIVERY (v1.1.7) — why every pushed file is ~1.9 MB
#
# Evidence: ben.traineddata.b64 (1,156,139 B) pushed fine, but
# eng.traineddata.b64 (5,556,280 B) failed with HTTP 413, and the APK
# .b64 (13,264,776 B) would fail too. The snapshot validator allows
# 16 MiB TOTAL, but the MCP push transport rejects large single
# requests — so every file pushed to GitHub must stay small.
#
# Scheme (chunk size 1,900,000 bytes, split -b 1900000):
# - APK: job-tracker.apk.b64 -> 7 parts, job-tracker.apk.b64.part01 …
#   .part07 (repo root). The SINGLE job-tracker.apk.b64 is NEVER pushed
#   (it would 413); it stays in the working dir only, as the source the
#   parts are split from.
# - eng traineddata: tessdata/eng.traineddata.b64 -> 3 parts,
#   tessdata/eng.traineddata.b64.part01 … .part03. The SINGLE
#   tessdata/eng.traineddata.b64 is likewise NEVER pushed.
# - ben traineddata: tessdata/ben.traineddata.b64 (1,156,139 B) is ONE
#   file, already live — do NOT split it, do NOT re-push it.
# Join order is always part01, part02, … in order; the join is plain
# concatenation of the base64 TEXT (no separators), then ONE base64
# decode of the joined text.
#
# Who joins what (part counts come from version.json, never hardcoded):
# - version.json: "apkParts": 7, "engParts": 3 (fallback 7 / 3 if the
#   field is missing, e.g. an old version.json).
# - App UpdateChecker: downloads the APK parts in order from the live
#   site, joins, decodes, installs exactly as before. Any part failing
#   (404 / no internet) aborts — nothing partial is ever installed.
# - App OcrHelper: downloads the 3 eng parts in order, joins, decodes,
#   saves as tessdata/eng.traineddata; ben still comes from the single
#   live file. Any part failing -> DOWNLOAD_FAILED, the caller shows the
#   existing Bengali message; OCR never runs on a partial file.
# - Website app.js downloadAppApk(): fetches the 7 APK parts in order,
#   joins, decodes, downloads as job-tracker.apk — one tap, one file.
#
# build-apk.sh does the split AUTOMATICALLY every build (APK parts after
# the base64 step; eng parts near the top) and VERIFIES both joins
# (joined sha256 must equal the source) before finishing. Future
# releases repeat it with no extra step — just run build-apk.sh and push
# the .partNN files + the code files (see the push list in the release
# notes; never include the single .b64 files).
#
# TRANSITION NOTE (v1.1.6 -> v1.1.7): the v1.1.6 app downloads the
# SINGLE /job-tracker.apk.b64, which stays the old version on the server
# (the new single .b64 is never pushed). So a v1.1.6 user tapping the
# in-app update banner would re-download v1.1.6. Those users must update
# ONCE from the website download button (which joins the parts); from
# v1.1.7 on, in-app updates work again (UpdateChecker uses parts).
#
# Pinned versions (v1.1.7): play-services-auth 21.2.0,
# firebase-messaging 23.4.1, tess-two 9.1.0, plus their transitive deps
# (play-services-base/basement/tasks 18.x, firebase-common/components/
# installations/datatransport, androidx fragment/activity/lifecycle/core,
# kotlinx-coroutines 1.6.x). kotlin-stdlib is NOT vendored — kotlinc
# -include-runtime already provides it.
#
# To re-fetch on a fresh machine, run /tmp/resolve2.py + /tmp/vendor.py
# (kept only on the build machine — ask Muse), or fetch the three roots
# and their POM closures from Maven by hand:
#
#     # tess-two AAR + traineddata
#     curl -O https://repo1.maven.org/maven2/com/rmtheis/tess-two/9.1.0/tess-two-9.1.0.aar
#     curl -o android-app/assets/tessdata/eng.traineddata \
#       https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata
#     curl -o android-app/assets/tessdata/ben.traineddata \
#       https://github.com/tesseract-ocr/tessdata_fast/raw/main/ben.traineddata
#     # play-services-auth + firebase-messaging (+ transitive AARs/JARs)
#     # from https://dl.google.com/dl/android/maven2 — see libs/vendor/
#     # for the full list of artifact names + versions.
#
# Firebase (FCM) is CODE-READY ONLY in v1.1.7: there is no
# google-services.json yet (gitignored, never commit it). Until the
# Firebase console step is done — create project, add Android app
# package com.jobtrackerbd.app with SHA-1
# 50:CA:0D:D4:A6:8F:77:5A:29:33:89:CB:3E:9E:19:02:F1:5E:45:B1,
# download google-services.json into android-app/ — PushHelper keeps FCM
# dormant and the app runs exactly as before. build-apk.sh generates the
# google_app_id values from that file automatically (no Gradle plugin
# step needed in this manual build).
#
# Google Sign-In is likewise CODE-READY ONLY: it uses the website's Web
# OAuth client (project gen-lang-client-0746409411) with requestIdToken,
# verified server-side by /api/auth-google. Real sign-in also needs an
# Android OAuth client in the same Google Cloud project with the SHA-1
# above — until then sign-in fails with ApiException 10 and the app says
# so in Bengali; manual login keeps working.
