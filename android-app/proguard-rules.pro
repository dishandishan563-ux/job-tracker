# Job Tracker — R8 / ProGuard rules (release only).
# Keep ONLY what the app needs to run. No blanket -keep for everything:
# a blanket keep would defeat obfuscation. Entry points and framework
# callbacks are kept; everything else is shrunk and renamed.
#
# NOTE: obfuscation makes the code very hard to read or steal, but no
# Android app can be made 100% unbreakable — say that plainly.

# --- Entry points: the launcher + all screens (found via the manifest) ---
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Application
-keep public class * extends android.content.ContentProvider
# v1.1.7: manifest-declared services + receivers (standalone R8 does NOT
# read the manifest, so these need explicit keeps — otherwise the push
# receiver / FCM service / Google sign-in revocation service would be
# shrunk away and pushes + sign-in would silently stop working).
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver

# --- Framework callbacks R8 cannot see from code ---
# (none of the app's own code uses reflection; org.json is a library)
-keepclassmembers class * extends android.content.ContentProvider {
    public <init>();
}

# --- Kotlin metadata (kept so R8 understands Kotlin; class/member names
#     are still obfuscated) ---
-keep class kotlin.Metadata { *; }
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable

# --- JSON model classes: field names are looked up by string at runtime
#     (org.json getString/optString), so keep the data classes' members.
#     Class names may still be renamed; only member names are kept.
-keepclassmembers class com.jobtrackerbd.app.Profile { *; }
-keepclassmembers class com.jobtrackerbd.app.CvInfo { *; }
-keepclassmembers class com.jobtrackerbd.app.UserData { *; }
-keepclassmembers class com.jobtrackerbd.app.Circular { *; }
-keepclassmembers class com.jobtrackerbd.app.Post { *; }

# --- ApkProvider is reached by the system via the manifest, not by code ---
-keep class com.jobtrackerbd.app.ApkProvider { *; }

# --- PdfBox-Android (tom-roush) — the AAR's own consumer rules, plus
#     keeps for the whole library: it loads some classes by reflection
#     (SecurityHandler) and reads its resources by path at runtime.
#     The library is public open-source code, so keeping its code while
#     still allowing name obfuscation is the safe trade-off; the app's
#     own code is still shrunk + renamed as before.
-keep,allowobfuscation class * extends com.tom_roush.pdfbox.pdmodel.encryption.SecurityHandler {
    public <init>(...);
}
-keep,allowobfuscation class com.tom_roush.pdfbox.pdmodel.documentinterchange.** { *; }
-keep,allowobfuscation class com.tom_roush.pdfbox.** { *; }
-keep,allowobfuscation class com.tom_roush.fontbox.** { *; }
-dontwarn com.tom_roush.**

# --- org.json is a framework library; do not warn on it ---
-dontwarn org.json.**
# Kotlin nullability annotations are compile-time only; the annotations
# jar is not a program input, so R8 must not fail on the missing classes.
-dontwarn org.jetbrains.annotations.**

# --- v1.1.7: Firebase / Play Services / tess-two ---
# Firebase components are loaded BY NAME from the ComponentDiscoveryService
# meta-data in the manifest — renaming them would break FirebaseApp init.
-keep class * implements com.google.firebase.components.ComponentRegistrar {
    *;
}
# Datatransport backend factory, also loaded by name from manifest meta-data.
-keep class com.google.android.datatransport.cct.CctBackendFactory { *; }
# PushService callbacks are invoked by Firebase, not by app code.
-keep class com.jobtrackerbd.app.PushService { *; }
# tess-two: JNI resolves native methods by name; keep the whole small class.
-keep class com.googlecode.tesseract.android.TessBaseAPI { *; }
-keep class com.googlecode.tesseract.android.TessBaseAPI$* { *; }
# Parcelable CREATORs (Google Sign-In account etc.) are found by reflection.
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}
# The vendored jars reference optional / platform classes R8 cannot see
# (annotations, coroutines internals, GMS dynamite). Warnings only.
-dontwarn com.google.**
-dontwarn androidx.**
-dontwarn com.googlecode.**
-dontwarn kotlinx.coroutines.**
-dontwarn com.google.android.datatransport.**
-dontwarn javax.inject.**
