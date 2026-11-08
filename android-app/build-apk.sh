#!/bin/bash
# Job Tracker NATIVE Android app (Kotlin) builder.
# No Gradle / Maven — uses only the local Android SDK (kotlinc + d8 + aapt2
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
ZIPALIGN="$SDK/build-tools/34.0.0/zipalign"
APKSIGNER="$SDK/build-tools/34.0.0/apksigner"
PLATFORM_JAR="$SDK/platforms/android-34/android.jar"
KEYSTORE="$ROOT/android-keystore/job-tracker-release.jks"

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
cp -r "$APP/res/values" "$APP/res/layout" "$APP/res/drawable" "$APP/res/mipmap-anydpi-v26" "$WORK/res/"

# ---------- resources ----------
"$AAPT2" compile --dir "$WORK/res" -o "$WORK/compiled.zip"
"$AAPT2" link -o "$WORK/app-unsigned.apk" -I "$PLATFORM_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  --java "$WORK/gen" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  "$WORK/compiled.zip"

# ---------- R.java -> classes ----------
"$JAVA_HOME/bin/javac" -encoding UTF-8 -source 8 -target 8 -cp "$PLATFORM_JAR" \
  -d "$WORK/classes" $(find "$WORK/gen" -name '*.java')

# ---------- kotlin -> jar (stdlib included) ----------
"$KOTLINC" "$APP"/src/com/jobtrackerbd/app/*.kt \
  -cp "$PLATFORM_JAR:$WORK/classes" \
  -jvm-target 1.8 -include-runtime -d "$WORK/app.jar"
"$JAVA_HOME/bin/jar" --create --file "$WORK/classes.jar" -C "$WORK/classes" .

# ---------- jar -> dex ----------
"$D8" --lib "$PLATFORM_JAR" --release --output "$WORK/dex" "$WORK/app.jar" "$WORK/classes.jar"

# ---------- add classes.dex, align, sign ----------
python3 - "$WORK/app-unsigned.apk" "$WORK/dex/classes.dex" <<'EOF'
import sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED) as z:
    z.write(dex, "classes.dex")
print("classes.dex added")
EOF
"$ZIPALIGN" -f 4 "$WORK/app-unsigned.apk" "$WORK/app-aligned.apk"

if [ -z "${KS_PASS:-}" ]; then
  KS_PASS="$(grep -A1 'same value' "$ROOT/android-keystore/README-LOCAL-ONLY.md" | tail -1 | tr -d '[:space:]')"
fi
export KS_PASS
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-key-alias jobtracker \
  --ks-pass env:KS_PASS --key-pass env:KS_PASS \
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
