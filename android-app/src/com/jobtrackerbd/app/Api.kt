package com.jobtrackerbd.app

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/** Minimal HTTP client for the existing Job Tracker Vercel APIs. No new endpoints. */
object Api {
    const val BASE = "https://job-tracker-official-68.vercel.app"
    const val APP_VERSION_NAME = "1.1.8"
    const val APP_VERSION_CODE = 10

    /**
     * Google OAuth Web client ID for project gen-lang-client-0746409411
     * (client 'Job Tracker') — the SAME client the website uses (it comes
     * from the public GET /api/config). A client ID is a public identifier,
     * not a secret; the secret stays server-side in Vercel only.
     * Used for requestIdToken() in Google Sign-In; the ID token is verified
     * server-side by /api/auth-google (aud must equal this ID).
     * NOTE: real sign-in also needs an Android OAuth client in the same
     * Google Cloud project with this app's SHA-1 — until then Google
     * sign-in fails with ApiException 10 (DEVELOPER_ERROR).
     */
    const val GOOGLE_WEB_CLIENT_ID =
        "298466691834-c0f8h98ijbugklo6f37he9l9qaid2haf.apps.googleusercontent.com"

    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * TEMPORARY DIAGNOSTIC (crash-locator build): the last data-load
     * error, if any — MainActivity shows it once on home. Remove
     * together with the display code.
     */
    var lastError: String? = null
        private set

    fun clearLastError() { lastError = null }

    data class Result(
        val ok: Boolean,
        val json: JSONObject? = null,
        val httpCode: Int = 0,
        val error: String = ""
    )

    private fun request(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        token: String? = null,
        cb: (Result) -> Unit
    ) {
        thread {
            var res = Result(false, null, 0, "ইন্টারনেট সংযোগ নেই।")
            try {
                val url = URL(if (path.startsWith("http")) path else BASE + path)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = method
                conn.connectTimeout = 15000
                conn.readTimeout = 20000
                conn.setRequestProperty("Accept", "application/json")
                if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
                if (body != null) {
                    conn.doOutput = true
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.let {
                    BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use { r -> r.readText() }
                } ?: ""
                val json = try {
                    JSONObject(text)
                } catch (e: Exception) {
                    null
                }
                val serverError = json?.optString("error", "") ?: ""
                res = Result(
                    ok = code in 200..299 && (json?.optBoolean("ok", true) != false),
                    json = json,
                    httpCode = code,
                    error = when {
                        serverError.isNotEmpty() -> serverError
                        code !in 200..299 -> "সার্ভার থেকে সাড়া মেলেনি ($code)।"
                        else -> ""
                    }
                )
            } catch (e: Exception) {
                res = Result(false, null, 0, "ইন্টারনেট সংযোগ নেই — আবার চেষ্টা করুন।")
            }
            val finalRes = res
            mainHandler.post { cb(finalRes) }
        }
    }

    fun get(path: String, cb: (Result) -> Unit) = request(path, "GET", null, null, cb)

    fun post(path: String, body: JSONObject, token: String? = null, cb: (Result) -> Unit) =
        request(path, "POST", body, token, cb)

    /** GET /api/circulars -> { ok, count, circulars: [...] } */
    fun fetchCirculars(cb: (List<Circular>, String) -> Unit) {
        get("/api/circulars") { r ->
            if (r.json == null) {
                cb(emptyList(), r.error)
                return@get
            }
            val list = mutableListOf<Circular>()
            val arr = r.json.optJSONArray("circulars")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    arr.optJSONObject(i)?.let { list.add(Circular.fromJson(it)) }
                }
            }
            cb(list, if (r.ok) "" else r.error)
        }
    }

    /** GET /api/config -> { googleClientId, contact, reminderOptions } */
    fun fetchConfig(cb: (JSONObject?) -> Unit) {
        get("/api/config") { r -> cb(if (r.ok) r.json else null) }
    }

    /** GET /api/online-check — runs Teletalk discovery + portal check. */
    fun onlineCheck(cb: (Result) -> Unit) = get("/api/online-check", cb)

    /** GET /version.json */
    fun fetchVersion(cb: (JSONObject?) -> Unit) {
        get("/version.json") { r -> cb(if (r.ok) r.json else null) }
    }

    /** POST /api/auth-google { credential: idToken } — the server verifies
     * the ID token with Google's tokeninfo endpoint (aud must equal the
     * Web client ID) and returns { email, name, token } exactly like the
     * manual login does. No client secret is ever in the app. */
    fun loginGoogle(idToken: String, cb: (Result) -> Unit) {
        val body = JSONObject().apply { put("credential", idToken) }
        post("/api/auth-google", body, null, cb)
    }

    /** POST /api/auth-manual { email, name?, hash } — hash = SHA-256("email:password"). */
    fun loginManual(email: String, name: String, password: String, cb: (Result) -> Unit) {
        val hash = Util.sha256Hex("$email:$password")
        val body = JSONObject().apply {
            put("email", email)
            put("name", name)
            put("hash", hash)
        }
        post("/api/auth-manual", body, null, cb)
    }

    /** POST /api/forgot-password { step: 'request', email } */
    fun forgotRequest(email: String, cb: (Result) -> Unit) {
        post(
            "/api/forgot-password",
            JSONObject().apply {
                put("step", "request")
                put("email", email)
            },
            null, cb
        )
    }

    /** POST /api/forgot-password { step: 'verify', email, code, newPassword, newHash } */
    fun forgotVerify(email: String, code: String, newPassword: String, cb: (Result) -> Unit) {
        post(
            "/api/forgot-password",
            JSONObject().apply {
                put("step", "verify")
                put("email", email)
                put("code", code)
                put("newPassword", newPassword)
                put("newHash", Util.sha256Hex("$email:$newPassword"))
                put("name", Store.name)
            },
            null, cb
        )
    }

    /** POST /api/user-data { action: 'load' } — server copy replaces the local cache. */
    fun loadUserData(cb: (UserData?) -> Unit) = refreshUserData(cb)

    /**
     * Fetch the server copy of the logged-in user's data and replace the
     * local cache with it (the server copy is the truth shared across
     * devices). On failure (offline / server error) the local cache is
     * kept as-is and cb gets null — never blanked. A 401 means the
     * session token is dead (expired): the user is logged out so the app
     * stops showing stale data as if it were still logged in.
     */
    fun refreshUserData(cb: ((UserData?) -> Unit)? = null) {
        val token = Store.token ?: run { cb?.invoke(null); return }
        post(
            "/api/user-data",
            JSONObject().apply { put("action", "load") },
            token
        ) { r ->
            try {
                if (r.httpCode == 401) {
                    Store.logout()
                    cb?.invoke(null)
                    return@post
                }
                val data = if (r.json?.optBoolean("ok") == true && r.json.optBoolean("exists")) {
                    UserData.fromJson(r.json.optJSONObject("data"))
                } else {
                    null
                }
                if (data != null) Store.cachedData = data
                cb?.invoke(data)
            } catch (t: Throwable) {
                // TEMPORARY DIAGNOSTIC: never crash on a bad data-load —
                // keep the cache and let home show the real error.
                lastError = "Data load: (${t.javaClass.simpleName}) — ${(t.message ?: "").take(100)}"
                cb?.invoke(null)
            }
        }
    }

    /**
     * Change the user's data safely: load the fresh server copy first,
     * apply the small change on top of it, then save it back. Without
     * this, a shortlist/status/font-size tap made from a stale local
     * cache would upload that stale copy whole and overwrite a newer
     * profile saved from the website (e.g. a CV uploaded there) with
     * the old empty one. If the fresh load fails (offline), the change
     * is applied to the local cache and the save is attempted as before.
     */
    fun updateUserData(mutator: (UserData) -> Unit, cb: ((Boolean) -> Unit)? = null) {
        if (!Store.isLoggedIn) {
            cb?.invoke(false)
            return
        }
        refreshUserData { fresh ->
            if (!Store.isLoggedIn) {
                // Token was dead (401 inside refresh): logged out already.
                cb?.invoke(false)
                return@refreshUserData
            }
            val data = fresh ?: Store.cachedData
            mutator(data)
            Store.cachedData = data
            saveUserData(data, cb)
        }
    }

    /** POST /api/user-data { action: 'save', data: {...} } */
    fun saveUserData(data: UserData, cb: ((Boolean) -> Unit)? = null) {
        val token = Store.token ?: run { cb?.invoke(false); return }
        post(
            "/api/user-data",
            JSONObject().apply {
                put("action", "save")
                put("data", data.toJson())
            },
            token
        ) { r -> cb?.invoke(r.json?.optBoolean("ok") == true) }
    }
}
