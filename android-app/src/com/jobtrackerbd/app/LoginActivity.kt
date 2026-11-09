package com.jobtrackerbd.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toolbar
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException

/**
 * Manual login / register (Gmail + name + password) + forgot password
 * + Google Sign-In (v1.1.7).
 *
 * Google Sign-In uses the website's existing Web OAuth client
 * (Api.GOOGLE_WEB_CLIENT_ID, project gen-lang-client-0746409411) with
 * requestIdToken(); the ID token is verified server-side by
 * POST /api/auth-google, and the login then proceeds exactly like a
 * manual login (same session token, same server data load).
 *
 * CODE-READY ONLY: a real sign-in also needs an Android OAuth client in
 * the same Google Cloud project, created with this app's SHA-1. Until
 * then Google returns ApiException 10 (DEVELOPER_ERROR) and the button
 * shows that in Bengali — manual login keeps working either way.
 */
class LoginActivity : Activity() {

    private val RC_GOOGLE_SIGN_IN = 9001

    private lateinit var emailEt: EditText
    private lateinit var nameEt: EditText
    private lateinit var passEt: EditText
    private lateinit var statusTv: TextView
    private var googleClient: GoogleSignInClient? = null
    // DIAGNOSTIC (build-D2): the setup error text, shown on the screen
    // so the phone tells us what actually failed.
    private var googleSetupError: String? = null

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
            nameEt = findViewById(R.id.name)
            passEt = findViewById(R.id.password)
            statusTv = findViewById(R.id.status)

            findViewById<Button>(R.id.loginBtn).setOnClickListener { doLogin() }

            // ---------- Google Sign-In ----------
            try {
                val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                    .requestIdToken(Api.GOOGLE_WEB_CLIENT_ID)
                    .requestEmail()
                    .build()
                googleClient = GoogleSignIn.getClient(this, gso)
            } catch (e: Throwable) {
                // Throwable, not just Exception: the R8-shrunk Play Services
                // code can also throw an Error here (missing class, bad
                // init) — that must leave Google login off, not kill the
                // whole login screen.
                googleClient = null
                // DIAGNOSTIC (build-D2): show the REAL error right away so
                // the phone tells us what actually failed.
                val detail = e.message?.trim()?.replace("\n", " ")?.take(100)
                googleSetupError = "Google লগইন হয়নি (" + e.javaClass.simpleName + ")" +
                    if (detail.isNullOrBlank()) "" else "\n" + detail
                statusTv.text = googleSetupError
            }
            findViewById<Button>(R.id.googleBtn).setOnClickListener {
                val client = googleClient
                if (client == null) {
                    // DIAGNOSTIC (build-D2): show the stored setup error
                    // instead of the generic line.
                    statusTv.text = googleSetupError
                        ?: "Google লগইন এই ফোনে চালু হয়নি — ম্যানুয়াল লগইন ব্যবহার করুন।"
                    return@setOnClickListener
                }
                statusTv.text = "Google অ্যাকাউন্ট বাছুন…"
                try {
                    startActivityForResult(client.signInIntent, RC_GOOGLE_SIGN_IN)
                } catch (e: Throwable) {
                    statusTv.text = "Google লগইন শুরু হয়নি — ম্যানুয়াল লগইন ব্যবহার করুন।"
                }
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
            // DIAGNOSTIC (build-D2): tiny build tag at the bottom of the
            // form card, so we can always tell which build is installed.
            // Diagnostic only — it must never break the login screen.
            try {
                val card = findViewById<TextView>(R.id.forgotLink).parent as? LinearLayout
                val density = resources.displayMetrics.density
                val tag = TextView(this)
                tag.text = "build-D2"
                tag.textSize = 11f
                tag.setTextColor(0xFF888888.toInt())
                tag.gravity = Gravity.CENTER
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
                lp.topMargin = (10 * density).toInt()
                tag.layoutParams = lp
                card?.addView(tag)
            } catch (t: Throwable) {
                // Ignore — the tag is diagnostic only.
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
        val name = nameEt.text.toString().trim()
        val pass = passEt.text.toString()
        if (!validEmail(email)) {
            statusTv.text = "সঠিক Gmail ঠিকানা দিন।"
            return
        }
        // Name is OPTIONAL for login: Gmail + password is enough. The
        // server returns the stored name on a successful login (used in
        // finishLogin). A blank name on REGISTRATION is rejected by the
        // server itself, so the app must not block it here.
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
            finishLogin(email, serverName.ifBlank { name }, token, created)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != RC_GOOGLE_SIGN_IN) return
        // Unprotected before: a null result intent (Back pressed on the
        // account picker) or a Play Services Error here killed the whole
        // login screen. Now it just shows the message instead.
        val task = try {
            GoogleSignIn.getSignedInAccountFromIntent(data)
        } catch (t: Throwable) {
            statusTv.text = "Google লগইন হয়নি — ম্যানুয়াল লগইন ব্যবহার করুন।"
            return
        }
        val account = try {
            task.getResult(ApiException::class.java)
        } catch (e: ApiException) {
            statusTv.text = when (e.statusCode) {
                // 10 = DEVELOPER_ERROR: no Android OAuth client with this
                // app's SHA-1 in Google Cloud yet — the remaining console
                // step, not a user error. Manual login still works.
                10 -> "Google লগইন এখনো চালু হয়নি (Android ক্লায়েন্ট বাকি আছে) — ম্যানুয়াল লগইন ব্যবহার করুন।"
                12501 -> "Google লগইন বাতিল হয়েছে।"
                7 -> "ইন্টারনেট সংযোগ নেই — আবার চেষ্টা করুন।"
                else -> "Google লগইন হয়নি (${e.statusCode}) — ম্যানুয়াল লগইন ব্যবহার করুন।"
            }
            return
        }
        val idToken = account?.idToken
        val email = account?.email ?: ""
        if (idToken.isNullOrBlank() || email.isBlank()) {
            statusTv.text = "Google থেকে লগইন তথ্য মেলেনি — ম্যানুয়াল লগইন ব্যবহার করুন।"
            return
        }
        statusTv.text = "Google যাচাই হচ্ছে…"
        Api.loginGoogle(idToken) { r ->
            if (!r.ok || r.json == null) {
                statusTv.text = when {
                    r.error.isNotEmpty() -> r.error
                    else -> "Google লগইন হয়নি — ম্যানুয়াল লগইন ব্যবহার করুন।"
                }
                return@loginGoogle
            }
            finishLogin(
                email,
                r.json.optString("name", account.displayName ?: "").ifBlank { email },
                r.json.optString("token", ""),
                false
            )
        }
    }

    /** Shared by manual + Google login: store the session, pull the
     * user's saved data from the server, then close with RESULT_OK. */
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
