package com.jobtrackerbd.app

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/** Local session + cached user data (SharedPreferences). Server copy is the truth. */
object Store {
    private const val PREF = "jt"
    private lateinit var prefs: SharedPreferences

    fun init(ctx: Context) {
        prefs = ctx.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE)
    }

    var token: String?
        get() = prefs.getString("jt_session", null)
        set(v) = prefs.edit().putString("jt_session", v).apply()

    var email: String
        get() = prefs.getString("jt_email", "") ?: ""
        set(v) = prefs.edit().putString("jt_email", v).apply()

    var name: String
        get() = prefs.getString("jt_name", "") ?: ""
        set(v) = prefs.edit().putString("jt_name", v).apply()

    var fontSize: String
        get() = prefs.getString("jt_font_size", "medium") ?: "medium"
        set(v) = prefs.edit().putString("jt_font_size", v).apply()

    val isLoggedIn: Boolean get() = !token.isNullOrBlank()

    fun logout() {
        prefs.edit().remove("jt_session").remove("jt_email").remove("jt_name").apply()
    }

    /** Cached user data (profile/shortlist/status) as one JSON string. */
    var cachedData: UserData
        get() {
            val raw = prefs.getString("jt_data", null) ?: return UserData()
            return try {
                UserData.fromJson(JSONObject(raw))
            } catch (e: Exception) {
                UserData()
            }
        }
        set(v) = prefs.edit().putString("jt_data", v.toJson().toString()).apply()

    /** Text-size scale factor for the whole app. Kept gentle (max 1.20x)
        so even the largest setting stays readable, never oversized. */
    fun fontScale(): Float = when (fontSize) {
        "small" -> 0.90f
        "large" -> 1.10f
        "xl" -> 1.20f
        else -> 1.0f
    }
}
