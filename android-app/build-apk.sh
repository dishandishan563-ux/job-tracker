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

# ---------- resources ----------
"$AAPT2" compile --dir "$WORK/res" -o "$WORK/compiled.zip"
"$AAPT2" link -o "$WORK/app-unsigned.apk" -I "$PLATFORM_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  --java "$WORK/gen" \
  -A "$PDFBOX_ASSETS" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  "$WORK/compiled.zip"

# ---------- R.java -> classes ----------
"$JAVA_HOME/bin/javac" -encoding UTF-8 -source 8 -target 8 -cp "$PLATFORM_JAR" \
  -d "$WORK/classes" $(find "$WORK/gen" -name '*.java')

# ---------- kotlin -> jar (stdlib included) ----------
"$KOTLINC" "$APP"/src/com/jobtrackerbd/app/*.kt \
  -cp "$PLATFORM_JAR:$WORK/classes:$PDFBOX_JAR" \
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
  "$WORK/app.jar" "$WORK/classes.jar" "$PDFBOX_JAR"
echo "R8 done: mapping at $WORK/mapping.txt (build-only, never committed)"
ls -l "$WORK/dex"

# ---------- add classes.dex, align, sign ----------
python3 - "$WORK/app-unsigned.apk" "$WORK/dex" <<'EOF'
import sys, zipfile, glob, os
apk, dexdir = sys.argv[1], sys.argv[2]
dexes = sorted(glob.glob(os.path.join(dexdir, "classes*.dex")))
assert dexes, "no dex files produced by R8"
with zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED) as z:
    for d in dexes:
        z.write(d, os.path.basename(d))
print("dex added:", [os.path.basename(d) for d in dexes])
EOF
"$ZIPALIGN" -f 4 "$WORK/app-unsigned.apk" "$WORK/app-aligned.apk"

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
echo "== DONE: Job Tracker (native) v$VERSION_NAME =="
