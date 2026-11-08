package com.jobtrackerbd.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.widget.Toolbar
import org.json.JSONObject

/** Settings — app settings only, nothing profile-related (profile is separate). */
class SettingsActivity : Activity() {

    private val PICK_CV = 2001
    private lateinit var cvStatus: TextView
    private lateinit var updateStatus: TextView
    private lateinit var whatsappBtn: Button
    private lateinit var telegramBtn: Button
    private lateinit var contactEmpty: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        setContentView(R.layout.activity_settings)
        val toolbar = findViewById<Toolbar>(R.id.toolbar)
        setActionBar(toolbar)
        actionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        cvStatus = findViewById(R.id.cvStatus)
        updateStatus = findViewById(R.id.updateStatus)
        whatsappBtn = findViewById(R.id.whatsappBtn)
        telegramBtn = findViewById(R.id.telegramBtn)
        contactEmpty = findViewById(R.id.contactEmpty)

        // ---------- text size ----------
        val sizeBtns = mapOf(
            "small" to findViewById<Button>(R.id.sizeSmall),
            "medium" to findViewById<Button>(R.id.sizeMedium),
            "large" to findViewById<Button>(R.id.sizeLarge),
            "xl" to findViewById<Button>(R.id.sizeXl)
        )
        val markSize = {
            for ((k, b) in sizeBtns) {
                b.text = when (k) {
                    "small" -> if (Store.fontSize == k) "✓ A-" else "A-"
                    "medium" -> if (Store.fontSize == k) "✓ A" else "A"
                    "large" -> if (Store.fontSize == k) "✓ A+" else "A+"
                    else -> if (Store.fontSize == k) "✓ A++" else "A++"
                }
            }
        }
        markSize()
        for ((k, b) in sizeBtns) {
            b.setOnClickListener {
                Store.fontSize = k
                val data = Store.cachedData
                data.fontSize = k
                Store.cachedData = data
                if (Store.isLoggedIn) Api.saveUserData(data)
                markSize()
                Ui.applyTextScale(findViewById(android.R.id.content))
                Ui.toast(this, "লেখার সাইজ বদলে গেছে।")
            }
        }

        // ---------- CV upload ----------
        findViewById<Button>(R.id.cvBtn).setOnClickListener {
            if (!Store.isLoggedIn) {
                Ui.toast(this, "CV আপলোড করতে আগে লগইন করুন।")
                startActivity(Intent(this, LoginActivity::class.java))
                return@setOnClickListener
            }
            val i = Intent(Intent.ACTION_GET_CONTENT).apply { type = "text/*" }
            startActivityForResult(Intent.createChooser(i, "CV ফাইল বেছে নিন"), PICK_CV)
        }

        // ---------- app version + update ----------
        findViewById<TextView>(R.id.versionText).text =
            "Job Tracker v${Api.APP_VERSION_NAME} (নেটিভ অ্যাপ)"
        findViewById<Button>(R.id.checkUpdateBtn).setOnClickListener {
            updateStatus.text = "আপডেট চেক হচ্ছে…"
            UpdateChecker.check(this, onNewVersion = { name, _ ->
                updateStatus.text = "🔔 নতুন আপডেট এসেছে (v$name) — ডাউনলোড করতে হোমের ব্যানারের বোতাম চাপুন।"
            }, onUpToDate = {
                updateStatus.text = "✓ সর্বশেষ সংস্করণ ব্যবহার করছেন (v${Api.APP_VERSION_NAME})।"
            })
        }

        // ---------- contact ----------
        Api.fetchConfig { json ->
            val contact: JSONObject? = json?.optJSONObject("contact")
            val wa = contact?.optString("whatsapp", "") ?: ""
            val tg = contact?.optString("telegram", "") ?: ""
            if (wa.isNotBlank()) {
                whatsappBtn.visibility = View.VISIBLE
                whatsappBtn.setOnClickListener { Ui.openUrl(this, wa) }
            }
            if (tg.isNotBlank()) {
                telegramBtn.visibility = View.VISIBLE
                telegramBtn.setOnClickListener { Ui.openUrl(this, tg) }
            }
            contactEmpty.visibility =
                if (wa.isBlank() && tg.isBlank()) View.VISIBLE else View.GONE
        }
        Ui.applyTextScale(findViewById(android.R.id.content))
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == PICK_CV && resultCode == RESULT_OK) {
            val uri = data?.data ?: return
            try {
                val text = contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
                val districts = listOf(
                    "ঢাকা", "চট্টগ্রাম", "খুলনা", "রাজশাহী", "বরিশাল", "সিলেট",
                    "রংপুর", "ময়মনসিংহ", "কুমিল্লা", "নারায়ণগঞ্জ", "পটুয়াখালী"
                )
                val found = districts.firstOrNull { text.contains(it) }
                val d = Store.cachedData
                if (found != null) {
                    d.profile.district = found
                    Store.cachedData = d
                    Api.saveUserData(d)
                    cvStatus.text = "CV আপলোড হয়েছে — জেলা পাওয়া গেছে: $found।"
                } else {
                    cvStatus.text = "CV আপলোড হয়েছে — জেলা পাওয়া যায়নি, প্রোফাইলে নিজে বসান।"
                }
            } catch (e: Exception) {
                cvStatus.text = "CV পড়া যায়নি — অন্য ফাইল চেষ্টা করুন।"
            }
        }
    }

    override fun onNavigateUp(): Boolean {
        finish()
        return true
    }
}
