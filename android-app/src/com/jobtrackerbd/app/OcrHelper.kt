package com.jobtrackerbd.app

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.googlecode.tesseract.android.TessBaseAPI
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * On-device OCR for image CVs (v1.1.7) — tess-two (Tesseract), the same
 * engine the website uses, with English + Bengali traineddata.
 *
 * Size note (v1.1.7 shrink): the traineddata files (eng 4.1 MB + ben
 * 0.86 MB) do NOT ship inside the APK any more — the APK would exceed
 * the GitHub push limit. They live at the repo root as base64 text
 * (tessdata/eng.traineddata.b64, tessdata/ben.traineddata.b64) — binary
 * files can never go through the GitHub snapshot push (UTF-8 only), so
 * this is the same .b64 delivery the project already uses for the APK
 * itself (job-tracker.apk.b64). The live site serves them; the app
 * downloads them once, on first OCR use, base64-decodes them, and saves
 * the decoded bytes into its private files dir (filesDir/tessdata/) and
 * caches them there, so the download happens only once. TessBaseAPI
 * needs a filesystem path (it cannot read from assets directly).
 *
 * Chunked delivery (v1.1.7): the GitHub push TRANSPORT also rejects
 * large single files (HTTP 413 — eng.traineddata.b64 at 5.5 MB failed
 * to push), so eng ships as ~1.9 MB parts (tessdata/eng.traineddata
 * .b64.part01 … .part03); ben (1.15 MB) pushed fine as ONE file and
 * stays single. Part count comes from /version.json (engParts, fallback
 * 3). The parts are fetched in order, joined as base64 text, decoded
 * once, and saved atomically — a failed part aborts the whole file.
 *
 * Use from a background thread — download + OCR take a few seconds.
 * Returns null when OCR cannot run or finds no text; the caller then
 * shows the same Bengali message the app already uses for scanned PDFs.
 */
object OcrHelper {
    private const val TAG = "OcrHelper"
    private const val LANG = "eng+ben"
    private val TRAINED = listOf("eng.traineddata", "ben.traineddata")

    /** Download base for traineddata — the live site serves tessdata/
     * from the repo root. Overridable for tests. */
    @Volatile
    var downloadBaseUrl: String = Api.BASE + "/tessdata/"

    enum class PrepStatus { READY, DOWNLOAD_FAILED, FAILED }

    fun isAvailable(): Boolean {
        return try {
            Class.forName("com.googlecode.tesseract.android.TessBaseAPI")
            true
        } catch (e: Throwable) {
            // Includes UnsatisfiedLinkError on devices without the
            // native lib: the APK ships arm64-v8a libs only, so 32-bit
            // devices (and x86 emulators) cannot run OCR at all.
            false
        }
    }

    /**
     * Make sure both traineddata files exist in <files>/tessdata/.
     * Per file: local cache first, then a bundled asset (dev builds
     * that still ship tessdata), then a download from the live site.
     * [onDownloadStart] is called on the calling thread when a
     * download begins, so the caller can show progress.
     * Returns DOWNLOAD_FAILED only when a needed file could not be
     * fetched (usually no internet) — the caller shows the Bengali
     * no-internet message for that case.
     */
    fun prepare(context: Context, onDownloadStart: (() -> Unit)? = null): PrepStatus {
        return try {
            val dir = File(context.filesDir, "tessdata")
            if (!dir.exists()) dir.mkdirs()
            for (name in TRAINED) {
                val out = File(dir, name)
                if (out.exists() && out.length() > 0) continue
                var ok = copyFromAssets(context, name, out)
                if (!ok) {
                    onDownloadStart?.invoke()
                    // eng ships in ~1.9 MB parts (see header note); ben is
                    // one live file. Either way a failed download returns
                    // DOWNLOAD_FAILED and the caller shows the Bengali
                    // no-internet message — OCR never runs on a partial file.
                    ok = if (name == "eng.traineddata") {
                        downloadChunked(name, fetchEngParts(), out)
                    } else {
                        downloadFile(downloadBaseUrl + name + ".b64", out)
                    }
                }
                if (!ok) return PrepStatus.DOWNLOAD_FAILED
            }
            if (TRAINED.all { File(dir, it).exists() }) PrepStatus.READY else PrepStatus.FAILED
        } catch (e: Exception) {
            Log.w(TAG, "traineddata prepare failed: ${e.message}")
            PrepStatus.FAILED
        }
    }

    // Bundled asset copy (dev builds that still ship tessdata in the
    // APK). Release builds have no such asset — open() throws and the
    // caller falls back to the download.
    private fun copyFromAssets(context: Context, name: String, out: File): Boolean {
        return try {
            context.assets.open("tessdata/$name").use { input ->
                FileOutputStream(out).use { output -> input.copyTo(output) }
            }
            out.length() > 0
        } catch (e: Exception) {
            false
        }
    }

    // Download one traineddata file to a temp file, then rename it into
    // place — a failed/partial download never leaves a broken file that
    // Tesseract would try to load. The server file is base64 text
    // (name.traineddata.b64 — binary can never go through the GitHub
    // snapshot push, UTF-8 only), so the response is base64-decoded and
    // only the decoded bytes are saved, under the plain .traineddata
    // name Tesseract expects.
    private fun downloadFile(urlStr: String, out: File): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            conn = URL(urlStr).openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 60000
            conn.instanceFollowRedirects = true
            conn.connect()
            if (conn.responseCode != HttpURLConnection.HTTP_OK) return false
            val b64 = conn.inputStream.use { it.readBytes() }
            if (b64.isEmpty()) return false
            val decoded = try {
                android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "traineddata base64 decode failed: ${e.message}")
                return false
            }
            if (decoded.isEmpty()) return false
            val tmp = File(out.parentFile, out.name + ".tmp")
            FileOutputStream(tmp).use { output -> output.write(decoded) }
            if (tmp.length() <= 0) {
                tmp.delete()
                return false
            }
            if (out.exists()) out.delete()
            tmp.renameTo(out) && out.length() > 0
        } catch (e: Exception) {
            Log.w(TAG, "traineddata download failed: ${e.message}")
            false
        } finally {
            conn?.disconnect()
        }
    }

    // Chunked download (v1.1.7): fetch the ~1.9 MB parts of one traineddata
    // file IN ORDER (name.b64.part01 … .partNN), join them as base64 text,
    // decode ONCE, and save atomically (temp + rename) — exactly the same
    // guarantees as downloadFile above. Any part failing (404 / no
    // internet / empty) aborts the whole file: false, and no partial
    // file is left for Tesseract to choke on. The joined text is only
    // decoded after ALL parts arrived, so a truncated join is caught by
    // the decoder instead of producing a corrupt traineddata file.
    private fun downloadChunked(name: String, partCount: Int, out: File): Boolean {
        return try {
            val joined = StringBuilder()
            for (i in 1..partCount) {
                val part = "%02d".format(i)
                val urlStr = downloadBaseUrl + name + ".b64.part" + part
                var conn: HttpURLConnection? = null
                try {
                    conn = URL(urlStr).openConnection() as HttpURLConnection
                    conn.connectTimeout = 15000
                    conn.readTimeout = 60000
                    conn.instanceFollowRedirects = true
                    conn.connect()
                    if (conn.responseCode != HttpURLConnection.HTTP_OK) return false
                    val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                    if (text.isBlank()) return false
                    joined.append(text.replace("\\s".toRegex(), ""))
                } finally {
                    conn?.disconnect()
                }
            }
            if (joined.isEmpty()) return false
            val decoded = try {
                android.util.Base64.decode(joined.toString(), android.util.Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "chunked traineddata base64 decode failed: ${e.message}")
                return false
            }
            if (decoded.isEmpty()) return false
            val tmp = File(out.parentFile, out.name + ".tmp")
            FileOutputStream(tmp).use { output -> output.write(decoded) }
            if (tmp.length() <= 0) {
                tmp.delete()
                return false
            }
            if (out.exists()) out.delete()
            tmp.renameTo(out) && out.length() > 0
        } catch (e: Exception) {
            Log.w(TAG, "chunked traineddata download failed: ${e.message}")
            false
        }
    }

    /** Part count for the chunked eng traineddata, from /version.json
     * (engParts). Any failure (offline, old version.json without the
     * field) falls back to 3 — the count build-apk.sh splits into. */
    private fun fetchEngParts(): Int {
        return try {
            val conn = URL(Api.BASE + "/version.json").openConnection() as HttpURLConnection
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            conn.instanceFollowRedirects = true
            conn.connect()
            if (conn.responseCode != HttpURLConnection.HTTP_OK) return 3
            val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val n = org.json.JSONObject(text).optInt("engParts", 3)
            if (n in 1..20) n else 3
        } catch (e: Exception) {
            3
        }
    }

    /**
     * Recognise text in a CV photo. The bitmap is downscaled first when
     * it is very large (OCR is slower and no more accurate on a 4000px
     * photo). Returns the recognised text, or null when nothing readable
     * was found / OCR failed.
     */
    fun ocrBitmap(context: Context, bitmap: Bitmap): String? {
        return try {
            if (prepare(context) != PrepStatus.READY) return null
            // Tesseract is slow above ~2000px on the long edge and gains
            // nothing — downscale, keeping the aspect ratio.
            val maxEdge = maxOf(bitmap.width, bitmap.height)
            val bmp = if (maxEdge > 2000) {
                val scale = 2000f / maxEdge
                Bitmap.createScaledBitmap(
                    bitmap,
                    (bitmap.width * scale).toInt(),
                    (bitmap.height * scale).toInt(),
                    true
                )
            } else bitmap
            val api = TessBaseAPI()
            try {
                if (!api.init(context.filesDir.absolutePath, LANG)) return null
                api.setImage(bmp)
                val text = api.utF8Text
                if (text.isNullOrBlank()) null else text
            } finally {
                try {
                    api.end()
                } catch (ignored: Throwable) {
                }
            }
        } catch (e: Throwable) {
            Log.w(TAG, "OCR failed: ${e.message}")
            null
        }
    }
}
