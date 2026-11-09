package com.jobtrackerbd.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toolbar

/**
 * Manual REGISTRATION only (name + Gmail + password) — a separate screen
 * from login, reached only from the login screen's register link.
 *
 * Registration calls the same POST /api/auth-manual with a name: the
 * server creates the account (created: true). If the Gmail already has
 * an account with a different password the server answers 401
 * wrong_password — shown as "account exists, please log in". No Google
 * button on this screen either.
 */
class RegisterActivity : Activity() {

    private lateinit var nameEt: EditText
    private lateinit var emailEt: EditText
    private lateinit var passEt: EditText
    private lateinit var statusTv: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        // Same safety net as LoginActivity: a throw while opening this
        // screen shows a message and goes back instead of killing the app.
        try {
            setContentView(R.layout.activity_register)
            val toolbar = findViewById<Toolbar>(R.id.toolbar)
            setActionBar(toolbar)
            actionBar?.setDisplayHomeAsUpEnabled(true)
            toolbar.setNavigationOnClickListener { finish() }

            nameEt = findViewById(R.id.name)
            emailEt = findViewById(R.id.email)
            passEt = findViewById(R.id.password)
            statusTv = findViewById(R.id.status)

            findViewById<Button>(R.id.registerBtn).setOnClickListener { doRegister() }

            findViewById<TextView>(R.id.loginLink).setOnClickListener {
                startActivity(Intent(this, LoginActivity::class.java))
                finish()
            }
            Ui.applyTextScale(findViewById(android.R.id.content))
        } catch (t: Throwable) {
            Ui.toast(this, "রেজিষ্ট্রেশন খোলা যায়নি — আবার চেষ্টা করুন।")
            finish()
        }
    }

    private fun validEmail(e: String): Boolean =
        Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""").matches(e)

    private fun doRegister() {
        val name = nameEt.text.toString().trim()
        val email = emailEt.text.toString().trim().lowercase()
        val pass = passEt.text.toString()
        if (name.isBlank()) {
            statusTv.text = "রেজিষ্ট্রেশনে আপনার নাম দিন।"
            return
        }
        if (!validEmail(email)) {
            statusTv.text = "সঠিক Gmail ঠিকানা দিন।"
            return
        }
        if (pass.length < 4) {
            statusTv.text = "পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে।"
            return
        }
        statusTv.text = "অ্যাকাউন্ট তৈরি হচ্ছে…"
        Api.loginManual(email, name, pass) { r ->
            if (!r.ok || r.json == null) {
                statusTv.text = when {
                    r.httpCode == 401 || r.error == "wrong_password" -> "এই Gmail-এ অ্যাকাউন্ট আছে — লগইন করুন।"
                    r.error.isNotEmpty() -> r.error
                    else -> "রেজিষ্ট্রেশন হয়নি — আবার চেষ্টা করুন।"
                }
                return@loginManual
            }
            val token = r.json.optString("token", "")
            val created = r.json.optBoolean("created", false)
            val serverName = r.json.optString("name", name)
            finishLogin(email, serverName.ifBlank { name }, token, created)
        }
    }

    /** Same as login: store the session, pull the user's saved data from
     * the server, then close with RESULT_OK. */
    private fun finishLogin(email: String, name: String, token: String, created: Boolean) {
        Store.token = token
        Store.email = email
        Store.name = name
        Api.loadUserData { data ->
            if (data != null) Store.cachedData = data
            // A push token may have arrived while logged out — send it now.
            PushHelper.flushPendingToken(this)
            Ui.toast(
                this,
                if (created) "অ্যাকাউন্ট তৈরি হয়েছে — স্বাগতম!" else "লগইন হয়েছে।"
            )
            setResult(RESULT_OK, Intent())
            finish()
        }
    }

    override fun onNavigateUp(): Boolean {
        finish()
        return true
    }
}
