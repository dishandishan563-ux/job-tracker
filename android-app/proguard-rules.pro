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

# --- org.json is a framework library; do not warn on it ---
-dontwarn org.json.**
# Kotlin nullability annotations are compile-time only; the annotations
# jar is not a program input, so R8 must not fail on the missing classes.
-dontwarn org.jetbrains.annotations.**
