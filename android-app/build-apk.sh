#!/bin/bash
# Job Tracker NATIVE Android app (Kotlin) builder.
# No Gradle / Maven — uses only the local Android SDK (kotlinc + R8 + aapt2
# + apksigner + zipalign) under ~/workspace/android-sdk.
# Output: android-app/build/job-tracker.apk (signed release) and
# job-tracker.apk.b64 at the repo root (base64 text, so it can be pushed
# to GitHub — the push route accepts UTF-8 text only, no binary files).
#
# Signing key: android-keystore/job-tracker-release.jks (gitignored, never
# committed). Password comes from env KS_PASS, or is read from
# android-keystore/README-LOCAL-ONLY.md. Future updates MUST use this
# same keystore + alias, or Android will refuse the update.
#
# Usage: ./android-app/build-apk.sh
# Version comes from android-app/VERSION (bump it together with version.json).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/android-app"
SDK="$HOME/workspace/android-sdk"
export JAVA_HOME="$SDK/jdk17"
export PATH="$JAVA_HOME/bin:$PATH"
KOTLINC="$SDK/kotlin-compiler/kotlinc/bin/kotlinc"
AAPT2="$SDK/build-tools/34.0.0/aapt2"
D8="$SDK/build-tools/34.0.0/d8"
R8_JAR="$SDK/cmdline-tools/latest/lib/r8.jar"
ZIPALIGN="$SDK/build-tools/34.0.0/zipalign"
APKSIGNER="$SDK/build-tools/34.0.0/apksigner"
PLATFORM_JAR="$SDK/platforms/android-34/android.jar"
KEYSTORE="$ROOT/android-keystore/job-tracker-release.jks"
# PdfBox-Android (text extraction for PDF CVs) — local-only jar + assets,
# see android-app/libs/README.md. NOT committed to GitHub (binary).
PDFBOX_JAR="$APP/libs/pdfbox-android-2.0.27.0.jar"
if [ ! -f "$PDFBOX_JAR" ]; then
  echo "ERROR: PdfBox-Android jar missing: $PDFBOX_JAR" >&2
  echo "See android-app/libs/README.md for how to re-fetch it." >&2
  exit 1
fi
PDFBOX_ASSETS="$APP/assets"
if [ ! -d "$PDFBOX_ASSETS" ]; then
  echo "ERROR: PdfBox-Android assets missing: $PDFBOX_ASSETS" >&2
  echo "See android-app/libs/README.md for how to re-fetch them." >&2
  exit 1
fi

# ---------- v1.1.7 vendored libraries (local-only, see libs/README.md) ----------
# No Gradle in this project: the Firebase / Play Services / tess-two AARs
# are vendored as jars under libs/vendor (classes.jar from each AAR), their
# resources under libs/aar-res (compiled by aapt2 below) and tess-two's
# native libs under libs/aar-jni. All local-only binaries, same as PdfBox:
# the APK (shipped as job-tracker.apk.b64) contains them, users never need
# these files, and a fresh machine re-fetches them per libs/README.md.
VENDOR_JARS="$(ls "$APP"/libs/vendor/*.jar 2>/dev/null | tr '\n' ' ')"
if [ -z "$VENDOR_JARS" ]; then
  echo "ERROR: no vendored jars in $APP/libs/vendor — see libs/README.md" >&2
  exit 1
fi
TESSDATA_DIR="$APP/assets/tessdata"
# v1.1.7 size fix: eng/ben.traineddata are NO LONGER bundled in the APK
# (they would push it over the GitHub push limit). They live at the repo
# root as base64 text (tessdata/*.traineddata.b64 — binary can never go
# through the GitHub snapshot push, UTF-8 only; same .b64 delivery as the
# APK itself), are served by the live site, and OcrHelper downloads and
# decodes them once on first OCR use. The local copies here are only the
# source for the repo copies — this check just verifies they still exist.
for f in eng.traineddata ben.traineddata; do
  if [ ! -f "$TESSDATA_DIR/$f" ]; then
    echo "ERROR: tess-two traineddata missing: $TESSDATA_DIR/$f" >&2
    echo "See libs/README.md for how to re-fetch it." >&2
    exit 1
  fi
done
if [ ! -f "$ROOT/tessdata/eng.traineddata.b64" ] || [ ! -f "$ROOT/tessdata/ben.traineddata.b64" ]; then
  echo "ERROR: repo-root tessdata/*.b64 copies missing — regenerate them from $TESSDATA_DIR:" >&2
  echo "  base64 $TESSDATA_DIR/eng.traineddata > \$ROOT/tessdata/eng.traineddata.b64" >&2
  echo "  base64 $TESSDATA_DIR/ben.traineddata > \$ROOT/tessdata/ben.traineddata.b64" >&2
  echo "They are served by the site and downloaded by the app on first OCR use." >&2
  exit 1
fi

# ---------- chunked delivery: eng traineddata (v1.1.7) ----------
# The GitHub push TRANSPORT rejects large single files (HTTP 413:
# eng.traineddata.b64 at 5.5 MB failed to push; ben at 1.15 MB went
# through fine as ONE file and stays single — do NOT split ben). So eng
# ships as 3 parts of ~1.9 MB. Regenerated here from the local
# traineddata (the source of truth), then split, then verified: the
# joined parts decoded must reproduce the source byte-identically.
# OcrHelper reads the part count from version.json (engParts, fallback 3)
# and joins the parts in order before decoding — see libs/README.md.
rm -f "$ROOT"/tessdata/eng.traineddata.b64.part*
base64 -w0 "$TESSDATA_DIR/eng.traineddata" > "$ROOT/tessdata/eng.traineddata.b64"
split -b 1900000 -d -a 2 --numeric-suffixes=1 \
  "$ROOT/tessdata/eng.traineddata.b64" "$ROOT/tessdata/eng.traineddata.b64.part"
ENG_JOIN_SHA="$(cat "$ROOT"/tessdata/eng.traineddata.b64.part* | base64 -d | sha256sum | cut -d' ' -f1)"
ENG_SRC_SHA="$(sha256sum "$TESSDATA_DIR/eng.traineddata" | cut -d' ' -f1)"
[ "$ENG_JOIN_SHA" = "$ENG_SRC_SHA" ] || { echo "ERROR: eng traineddata part join mismatch" >&2; exit 1; }
echo "eng traineddata: 3 parts, joined+decoded sha256 matches source"
ls -l "$ROOT"/tessdata/eng.traineddata.b64.part*

# shellcheck disable=SC1091
source "$APP/VERSION"  # sets VERSION_CODE and VERSION_NAME
WORK="$APP/build"
rm -rf "$WORK"
mkdir -p "$WORK/res" "$WORK/classes" "$WORK/dex" "$WORK/gen"

echo "== Building Job Tracker (native) v$VERSION_NAME (code $VERSION_CODE) =="

# ---------- launcher icons (generated from code, no binary input) ----------
python3 - "$WORK/res" <<'EOF'
import sys, os
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
GREEN = (20, 83, 45, 255)
WHITE = (255, 255, 255, 255)
for name, size in [("mipmap-mdpi", 48), ("mipmap-hdpi", 72), ("mipmap-xhdpi", 96),
                   ("mipmap-xxhdpi", 144), ("mipmap-xxxhdpi", 192)]:
    os.makedirs(f"{out}/{name}", exist_ok=True)
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 5, fill=GREEN)
    f = ImageFont.truetype(FONT, int(size * 0.42))
    bbox = d.textbbox((0, 0), "JT", font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1] - size * 0.02),
           "JT", font=f, fill=WHITE)
    im.save(f"{out}/{name}/ic_launcher.png")
    im.save(f"{out}/{name}/ic_launcher_round.png")
    print("icon", name, size)
EOF
cp -r "$APP/res/values" "$APP/res/layout" "$APP/res/drawable" "$APP/res/color" "$APP/res/mipmap-anydpi-v26" "$WORK/res/"

# ---------- Firebase values from google-services.json (v1.1.7, optional) ----------
# The google-services Gradle plugin normally generates these string
# resources from google-services.json. This manual build does the same
# (only when the file exists — it does NOT exist yet, so this step is a
# no-op until the Firebase console step is done and the file is dropped
# into android-app/). PushHelper gates FCM on the google_app_id resource:
# no file -> no resource -> FCM stays dormant, app runs as before.
if [ -f "$APP/google-services.json" ]; then
  python3 - "$APP/google-services.json" "$WORK/res/values/firebase_values.xml" <<'EOF'
import sys, json
src, dst = sys.argv[1], sys.argv[2]
cfg = json.load(open(src))
client = (cfg.get("client") or [{}])[0]
info = client.get("client_info", {})
api_key = (client.get("api_key") or [{}])[0].get("current_key", "")
proj = cfg.get("project_info", {})
vals = {
    "google_app_id": info.get("mobilesdk_app_id", ""),
    "gcm_defaultSenderId": proj.get("project_number", ""),
    "google_api_key": api_key,
    "google_project_id": proj.get("project_id", ""),
}
if proj.get("firebase_url"):
    vals["firebase_database_url"] = proj["firebase_url"]
if proj.get("storage_bucket"):
    vals["google_storage_bucket"] = proj["storage_bucket"]
lines = ['<?xml version="1.0" encoding="utf-8"?>',
         '<!-- Generated by build-apk.sh from google-services.json (do not edit) -->',
         '<resources>']
for k, v in vals.items():
    if v:
        v = str(v).replace("&", "&amp;").replace("<", "&lt;")
        lines.append(f'    <string name="{k}" translatable="false">{v}</string>')
lines.append('</resources>')
open(dst, "w").write("\n".join(lines) + "\n")
print("firebase values generated from google-services.json")
EOF
else
  echo "no google-services.json — FCM stays dormant (see PushHelper)"
fi

# ---------- resources ----------
# AAR resources (play-services / androidx / firebase) are compiled one
# directory at a time; --auto-add-overlay at link lets the same resource
# name exist in several libraries (as the Gradle merger allows).
AAR_COMPILED=""
for resdir in "$APP"/libs/aar-res/*/; do
  [ -d "$resdir" ] || continue
  name="$(basename "$resdir")"
  "$AAPT2" compile --dir "$resdir" -o "$WORK/compiled-$name.zip"
  AAR_COMPILED="$AAR_COMPILED $WORK/compiled-$name.zip"
done
"$AAPT2" compile --dir "$WORK/res" -o "$WORK/compiled.zip"
# APK assets: PdfBox resources (assets/com/) ONLY. tessdata is NOT
# bundled any more (v1.1.7 size fix) — it is staged out here so the
# -A dir below never sees it.
STAGE_ASSETS="$WORK/assets"
mkdir -p "$STAGE_ASSETS"
cp -r "$PDFBOX_ASSETS/com" "$STAGE_ASSETS/"
"$AAPT2" link -o "$WORK/app-unsigned.apk" -I "$PLATFORM_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  --java "$WORK/gen" \
  -A "$STAGE_ASSETS" \
  --auto-add-overlay \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  "$WORK/compiled.zip" $AAR_COMPILED

# ---------- R.java -> classes ----------
"$JAVA_HOME/bin/javac" -encoding UTF-8 -source 8 -target 8 -cp "$PLATFORM_JAR" \
  -d "$WORK/classes" $(find "$WORK/gen" -name '*.java')

# ---------- kotlin -> jar (stdlib included) ----------
# Classpath: android.jar + generated R classes + PdfBox + all vendored jars
# (Firebase / Play Services / tess-two / androidx). kotlin-stdlib is NOT in
# libs/vendor (kotlinc -include-runtime already provides it).
VENDOR_CP="$(echo "$VENDOR_JARS" | tr ' ' ':')"
"$KOTLINC" "$APP"/src/com/jobtrackerbd/app/*.kt \
  -cp "$PLATFORM_JAR:$WORK/classes:$PDFBOX_JAR:$VENDOR_CP" \
  -jvm-target 1.8 -include-runtime -d "$WORK/app.jar"
"$JAVA_HOME/bin/jar" --create --file "$WORK/classes.jar" -C "$WORK/classes" .

# ---------- jar -> dex (R8: shrink + obfuscate the release build) ----------
# R8 replaces d8 here: minify + obfuscate with proguard-rules.pro (keeps
# only entry points / framework callbacks / JSON model members — no
# blanket keep). The mapping file stays in build/ only: it is never
# committed to the repo (build/ is gitignored) and never shipped in the APK.
# shrinkResources has no standalone-R8 equivalent (it is an AGP feature);
# R8's shrinking + unused-resource removal by aapt2 link is what applies.
if [ ! -f "$R8_JAR" ]; then
  echo "ERROR: R8 jar not found at $R8_JAR — release build must be obfuscated." >&2
  exit 1
fi
# -printmapping lives in a generated config so the path is absolute:
# a relative path in proguard-rules.pro would land in the caller's CWD.
printf -- '-printmapping %s\n' "$WORK/mapping.txt" > "$WORK/r8-args.pro"
"$JAVA_HOME/bin/java" -cp "$R8_JAR" com.android.tools.r8.R8 --release \
  --output "$WORK/dex" \
  --lib "$PLATFORM_JAR" \
  --min-api 24 \
  --pg-conf "$APP/proguard-rules.pro" \
  --pg-conf "$WORK/r8-args.pro" \
  "$WORK/app.jar" "$WORK/classes.jar" "$PDFBOX_JAR" $VENDOR_JARS
echo "R8 done: mapping at $WORK/mapping.txt (build-only, never committed)"
ls -l "$WORK/dex"

# ---------- add classes.dex + native libs, align, sign ----------
# tess-two native libs, arm64-v8a ONLY (v1.1.7 size fix: armeabi-v7a was
# dropped to fit the GitHub push limit — most phones from the last 5+
# years are arm64; on a 32-bit device the app still installs and runs,
# and OcrHelper reports image OCR unavailable there with a Bengali
# message saying a 64-bit phone is needed; PDF CVs still work).
# .so files are stored UNCOMPRESSED so the system can load them straight
# from the APK; zipalign -p page-aligns them for that.
python3 - "$WORK/app-unsigned.apk" "$WORK/dex" "$APP/libs/aar-jni" <<'EOF'
import sys, zipfile, glob, os
apk, dexdir, jnidir = sys.argv[1], sys.argv[2], sys.argv[3]
dexes = sorted(glob.glob(os.path.join(dexdir, "classes*.dex")))
assert dexes, "no dex files produced by R8"
with zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED) as z:
    for d in dexes:
        z.write(d, os.path.basename(d))
    for abi in ("arm64-v8a",):
        for so in sorted(glob.glob(os.path.join(jnidir, abi, "*.so"))):
            arc = f"lib/{abi}/{os.path.basename(so)}"
            z.write(so, arc, compress_type=zipfile.ZIP_STORED)
            print("native lib added:", arc)
print("dex added:", [os.path.basename(d) for d in dexes])
EOF
"$ZIPALIGN" -f -p 4 "$WORK/app-unsigned.apk" "$WORK/app-aligned.apk"

if [ -z "${KS_PASS:-}" ]; then
  KS_PASS="$(grep -A1 'same value' "$ROOT/android-keystore/README-LOCAL-ONLY.md" | tail -1 | tr -d '[:space:]')"
fi
export KS_PASS
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-key-alias jobtracker \
  --ks-pass env:KS_PASS --key-pass env:KS_PASS \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$WORK/job-tracker.apk" "$WORK/app-aligned.apk"

# ---------- verify ----------
"$APKSIGNER" verify --verbose "$WORK/job-tracker.apk"
"$AAPT2" dump badging "$WORK/job-tracker.apk" | grep -E "package:|application-label|launchable-activity"

# ---------- base64 for GitHub (text-only push route) ----------
base64 -w0 "$WORK/job-tracker.apk" > "$ROOT/job-tracker.apk.b64"
APK_SHA="$(sha256sum "$WORK/job-tracker.apk" | cut -d' ' -f1)"
echo "APK:  $WORK/job-tracker.apk ($(stat -c%s "$WORK/job-tracker.apk") bytes, sha256 $APK_SHA)"
echo "B64:  $ROOT/job-tracker.apk.b64 ($(stat -c%s "$ROOT/job-tracker.apk.b64") bytes)"

# ---------- chunked delivery: APK (v1.1.7) ----------
# The single .b64 (13 MB) is rejected by the GitHub push transport
# (HTTP 413 — same reason eng.traineddata.b64 failed at 5.5 MB), even
# though the snapshot validator allows 16 MiB total. So the .b64 is
# split into 7 parts of ~1.9 MB each; ONLY the .partNN files are pushed
# to GitHub — never the single job-tracker.apk.b64. UpdateChecker reads
# the part count from version.json (apkParts, fallback 7), the website
# (app.js) does the same, and both join the parts in order before
# decoding — see android-app/libs/README.md. The single .b64 stays in
# the working dir only, as the source the parts are split from.
rm -f "$ROOT"/job-tracker.apk.b64.part*
split -b 1900000 -d -a 2 --numeric-suffixes=1 \
  "$ROOT/job-tracker.apk.b64" "$ROOT/job-tracker.apk.b64.part"
JOIN_SHA="$(cat "$ROOT"/job-tracker.apk.b64.part* | sha256sum | cut -d' ' -f1)"
B64_SHA="$(sha256sum "$ROOT/job-tracker.apk.b64" | cut -d' ' -f1)"
[ "$JOIN_SHA" = "$B64_SHA" ] || { echo "ERROR: APK part join mismatch" >&2; exit 1; }
echo "APK parts: 7 files, joined sha256 matches job-tracker.apk.b64"
ls -l "$ROOT"/job-tracker.apk.b64.part*
echo "== DONE: Job Tracker (native) v$VERSION_NAME =="
