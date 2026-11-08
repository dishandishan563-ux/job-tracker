package com.jobtrackerbd.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.widget.Toolbar
import org.json.JSONObject

/** Settings — app settings only, nothing profile-related (profile is separate). */
class SettingsActivity : Activity() {

    private val PICK_CV = 2001
    private lateinit var cvStatus: TextView
    private lateinit var cvRemoveBtn: Button
    private lateinit var updateStatus: TextView
    private lateinit var whatsappBtn: Button
    private lateinit var telegramBtn: Button
    private lateinit var contactEmpty: TextView
    private var removeArmed: Boolean = false

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
        // Same flow as the website: PDF, text or image file → text is read
        // (PDF via CvParse, the port of cv-parse.js) → fields are parsed →
        // they fill the profile and are saved with the profile to the
        // server (api/user-data), so they show in আমার প্রোফাইল.
        // The old picker used type "text/*", which hid every PDF — that is
        // why PDF upload did not work from the app.
        cvRemoveBtn = findViewById(R.id.cvRemoveBtn)
        refreshCvState()
        findViewById<Button>(R.id.cvBtn).setOnClickListener {
            if (!Store.isLoggedIn) {
                Ui.toast(this, "CV আপলোড করতে আগে লগইন করুন।")
                startActivity(Intent(this, LoginActivity::class.java))
                return@setOnClickListener
            }
            val i = Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "*/*"
                putExtra(
                    Intent.EXTRA_MIME_TYPES,
                    arrayOf("application/pdf", "text/plain", "image/*")
                )
            }
            startActivityForResult(Intent.createChooser(i, "CV ফাইল বেছে নিন"), PICK_CV)
        }
        cvRemoveBtn.setOnClickListener {
            if (!removeArmed) {
                removeArmed = true
                cvRemoveBtn.text = getString(R.string.cv_remove_confirm)
                Handler(Looper.getMainLooper()).postDelayed({
                    removeArmed = false
                    cvRemoveBtn.text = getString(R.string.cv_remove)
                }, 3000)
                return@setOnClickListener
            }
            removeArmed = false
            cvRemoveBtn.text = getString(R.string.cv_remove)
            val d = Store.cachedData
            val snap = d.profile.cv?.fields ?: emptyMap()
            d.profile = CvParse.removeCvFields(d.profile, snap)
            Store.cachedData = d
            Api.saveUserData(d)
            cvStatus.text = "CV মুছে ফেলা হয়েছে — প্রোফাইল থেকে CV-র তথ্য সরানো হয়েছে।"
            refreshCvState()
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

    private fun refreshCvState() {
        val cv = Store.cachedData.profile.cv
        if (cv != null && cv.name.isNotBlank()) {
            cvStatus.text = "CV আপলোড করা আছে: ${cv.name}।"
            cvRemoveBtn.visibility = View.VISIBLE
        } else {
            cvRemoveBtn.visibility = View.GONE
        }
    }

    private fun displayName(uri: android.net.Uri): String? {
        return try {
            contentResolver.query(uri, null, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) c.getString(idx) else null
                } else null
            }
        } catch (e: Exception) {
            null
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == PICK_CV && resultCode == RESULT_OK) {
            val uri = data?.data ?: return
            try {
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: run { cvStatus.text = "CV পড়া যায়নি — অন্য ফাইল চেষ্টা করুন।"; return }
                val mime = contentResolver.getType(uri)
                val name = displayName(uri) ?: "cv"
                val text = CvParse.extractText(bytes, mime, name)
                if (text == null) {
                    cvStatus.text = "ছবির CV থেকে লেখা পড়া যায়নি — PDF বা টেক্সট CV দিন।"
                    return
                }
                if (text.isBlank()) {
                    cvStatus.text = "CV থেকে লেখা পাওয়া যায়নি — অন্য ফাইল চেষ্টা করুন।"
                    return
                }
                val fields = CvParse.parseCvText(text)
                val d = Store.cachedData
                // CV-ই শেষ কথা: CV-তে যা আছে তা-ই প্রোফাইলে বসবে, আগের মান
                // থাকলেও CV-র মান জিতবে (ওয়েবসাইটের applyCvFieldsToProfile
                // এখন overwriteCvFields ব্যবহার করে)।
                val (merged, filled) = CvParse.overwriteCvFields(d.profile, fields)
                val fieldsStr = fields.mapValues { it.value.toString() }
                merged.cv = CvInfo(
                    name = name,
                    size = bytes.size.toLong(),
                    uploadedAt = System.currentTimeMillis(),
                    text = text.take(4000),
                    fields = fieldsStr
                )
                d.profile = merged
                Store.cachedData = d
                Api.saveUserData(d)
                refreshCvState()
                cvStatus.text = if (filled.isEmpty()) {
                    "CV আপলোড হয়েছে — কোনো তথ্য মেলেনি, প্রোফাইলে নিজে বসান।"
                } else {
                    val labels = filled.mapNotNull { CvParse.FIELD_LABELS[it] }
                    "CV আপলোড হয়েছে — প্রোফাইলে বসেছে: ${labels.joinToString(", ")}।"
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
