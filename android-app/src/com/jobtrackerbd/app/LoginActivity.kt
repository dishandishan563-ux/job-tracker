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

/** Manual login / register (Gmail + name + password) + forgot password. */
class LoginActivity : Activity() {

    private lateinit var emailEt: EditText
    private lateinit var nameEt: EditText
    private lateinit var passEt: EditText
    private lateinit var statusTv: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        setContentView(R.layout.activity_login)
        val toolbar = findViewById<Toolbar>(R.id.toolbar)
        setActionBar(toolbar)
        actionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        emailEt = findViewById(R.id.email)
        nameEt = findViewById(R.id.name)
        passEt = findViewById(R.id.password)
        statusTv = findViewById(R.id.status)

        findViewById<Button>(R.id.loginBtn).setOnClickListener { doLogin() }

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
    }

    private fun setFpStatus(msg: String) {
        findViewById<TextView>(R.id.fpStatus).text = msg
    }

    private fun validEmail(e: String): Boolean =
        Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""").matches(e)

    private fun doLogin() {
        val email = emailEt.text.toString().trim().lowercase()
        val name = nameEt.text.toString().trim()
        val pass = passEt.text.toString()
        if (!validEmail(email)) {
            statusTv.text = "সঠিক Gmail ঠিকানা দিন।"
            return
        }
        // The server stores a blank name as-is on registration, so a
        // nameless account would be created — the name field is shown
        // on this screen, so require it here.
        if (name.isBlank()) {
            statusTv.text = "আপনার নাম দিন।"
            return
        }
        if (pass.length < 4) {
            statusTv.text = "পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে।"
            return
        }
        statusTv.text = "লগইন হচ্ছে…"
        Api.loginManual(email, name, pass) { r ->
            if (!r.ok || r.json == null) {
                statusTv.text = when {
                    r.httpCode == 401 || r.error == "wrong_password" -> "ভুল পাসওয়ার্ড।"
                    r.error.isNotEmpty() -> r.error
                    else -> "লগইন হয়নি — আবার চেষ্টা করুন।"
                }
                return@loginManual
            }
            val token = r.json.optString("token", "")
            val created = r.json.optBoolean("created", false)
            val serverName = r.json.optString("name", name)
            Store.token = token
            Store.email = email
            Store.name = serverName.ifBlank { name }
            // Pull the user's saved data from the server.
            Api.loadUserData { data ->
                if (data != null) Store.cachedData = data
                Ui.toast(
                    this,
                    if (created) "অ্যাকাউন্ট তৈরি হয়েছে — স্বাগতম!" else "লগইন হয়েছে।"
                )
                setResult(RESULT_OK, Intent())
                finish()
            }
        }
    }

    override fun onNavigateUp(): Boolean {
        finish()
        return true
    }
}
