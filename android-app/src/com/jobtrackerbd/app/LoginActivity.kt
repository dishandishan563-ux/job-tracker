package com.jobtrackerbd.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toolbar

/**
 * Manual LOGIN only (Gmail + password). Registration lives on its own
 * screen (RegisterActivity) — no name field here.
 *
 * Login calls POST /api/auth-manual with an empty name: the server logs
 * in when the account exists, and answers 400 name_required when it
 * does not — that is shown as "no account, please register". Google
 * Sign-In was removed from the app at the owner's request (2026-11-09)
 * — the website still offers Google login; the app is manual-only.
 */
class LoginActivity : Activity() {

    private lateinit var emailEt: EditText
    private lateinit var passEt: EditText
    private lateinit var statusTv: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        // Safety net (v1.1.7 hotfix): if any step of opening this screen
        // throws on a device, show a message and go back instead of
        // the app being killed ("বের করে দেয়").
        try {
            setContentView(R.layout.activity_login)
            val toolbar = findViewById<Toolbar>(R.id.toolbar)
            setActionBar(toolbar)
            actionBar?.setDisplayHomeAsUpEnabled(true)
            toolbar.setNavigationOnClickListener { finish() }

            emailEt = findViewById(R.id.email)
            passEt = findViewById(R.id.password)
            statusTv = findViewById(R.id.status)

            findViewById<Button>(R.id.loginBtn).setOnClickListener { doLogin() }

            findViewById<TextView>(R.id.registerLink).setOnClickListener {
                startActivity(Intent(this, RegisterActivity::class.java))
                finish()
            }

            val forgotPanel = findViewById<LinearLayout>(R.id.forgotPanel)
            findViewById<TextView>(R.id.forgotLink).setOnClickListener {
                forgotPanel.visibility =
                    if (forgotPanel.visibility == View.VISIBLE) View.GONE else View.VISIBLE
            }
            findViewById<Button>(R.id.fpSendBtn).setOnClickListener {
                val email = emailEt.text.toString().trim().lowercase()
                if (!validEmail(email)) {
                    setFpStatus("সঠিক Gmail ঠিকানা দিন।")
                    return@setOnClickListener
                }
                setFpStatus("কোড পাঠানো হচ্ছে…")
                Api.forgotRequest(email) { r ->
                    setFpStatus(if (r.ok) (r.json?.optString("note") ?: "কোড পাঠানো হয়েছে।") else r.error)
                }
            }
            findViewById<Button>(R.id.fpVerifyBtn).setOnClickListener {
                val email = emailEt.text.toString().trim().lowercase()
                val code = findViewById<EditText>(R.id.fpCode).text.toString().trim()
                val newPass = findViewById<EditText>(R.id.fpNewPass).text.toString()
                if (!validEmail(email) || code.length != 6 || newPass.length < 4) {
                    setFpStatus("Gmail, ৬ সংখ্যার কোড ও নতুন পাসওয়ার্ড — সব দিন।")
                    return@setOnClickListener
                }
                setFpStatus("যাচাই হচ্ছে…")
                Api.forgotVerify(email, code, newPass) { r ->
                    if (r.ok) {
                        setFpStatus("✓ নতুন পাসওয়ার্ড সেট হয়েছে — এখন লগইন করুন।")
                        passEt.setText(newPass)
                    } else {
                        setFpStatus(r.error)
                    }
                }
            }
            Ui.applyTextScale(findViewById(android.R.id.content))
        } catch (t: Throwable) {
            Ui.toast(this, "লগইন খোলা যায়নি — আবার চেষ্টা করুন।")
            finish()
        }
    }

    private fun setFpStatus(msg: String) {
        findViewById<TextView>(R.id.fpStatus).text = msg
    }

    private fun validEmail(e: String): Boolean =
        Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""").matches(e)

    private fun doLogin() {
        val email = emailEt.text.toString().trim().lowercase()
        val pass = passEt.text.toString()
        if (!validEmail(email)) {
            statusTv.text = "সঠিক Gmail ঠিকানা দিন।"
            return
        }
        if (pass.length < 4) {
            statusTv.text = "পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে।"
            return
        }
        statusTv.text = "লগইন হচ্ছে…"
        // Empty name: login only. The server returns the stored name on
        // success; a missing account comes back 400 name_required.
        Api.loginManual(email, "", pass) { r ->
            if (!r.ok || r.json == null) {
                statusTv.text = when {
                    r.httpCode == 401 || r.error == "wrong_password" -> "ভুল পাসওয়ার্ড।"
                    r.httpCode == 400 -> "এই Gmail-এ অ্যাকাউন্ট নেই — নিচে রেজিষ্ট্রেশন করুন।"
                    r.error.isNotEmpty() -> r.error
                    else -> "লগইন হয়নি — আবার চেষ্টা করুন।"
                }
                return@loginManual
            }
            val token = r.json.optString("token", "")
            val serverName = r.json.optString("name", "")
            finishLogin(email, serverName, token)
        }
    }

    /** Store the session, pull the user's saved data from the server,
     * then close with RESULT_OK. */
    private fun finishLogin(email: String, name: String, token: String) {
        Store.token = token
        Store.email = email
        Store.name = name
        Api.loadUserData { data ->
            if (data != null) Store.cachedData = data
            // A push token may have arrived while logged out — send it now.
            PushHelper.flushPendingToken(this)
            Ui.toast(this, "লগইন হয়েছে।")
            setResult(RESULT_OK, Intent())
            finish()
        }
    }

    override fun onNavigateUp(): Boolean {
        finish()
        return true
    }
}
