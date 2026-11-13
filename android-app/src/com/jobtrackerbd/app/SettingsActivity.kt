package com.jobtrackerbd.app

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.widget.ToggleButton
import android.widget.Toolbar
import org.json.JSONObject
import kotlin.concurrent.thread

/** Settings — app settings only, nothing profile-related (profile is separate). */
class SettingsActivity : Activity() {

    private val PICK_CV = 2001
    private val RC_PUSH_NOTIF = 3001
    private lateinit var cvStatus: TextView
    private lateinit var cvRemoveBtn: Button
    private lateinit var updateStatus: TextView
    private lateinit var whatsappBtn: Button
    private lateinit var telegramBtn: Button
    private lateinit var contactEmpty: TextView
    private var removeArmed: Boolean = false

    /** Scanned (image-only) file — no readable text layer. The same
     * message is used for a scanned PDF and for an image CV whose OCR
     * finds no text. */
    private val NO_TEXT_MSG =
        "এই PDF-এ লেখার লেয়ার নেই (স্ক্যান করা ছবি) — টেক্সট PDF ব্যবহার করুন, অথবা ওয়েবসাইট দিয়ে আপলোড করুন (ওয়েবসাইট ছবির CV পড়তে পারে)।"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        // Safety net (v1.1.7 hotfix): if any step of opening this screen
        // throws on a device, show a message and go back instead of
        // the app being killed ("বের করে দেয়").
        try {
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
                    val active = Store.fontSize == k
                    b.text = when (k) {
                        "small" -> if (active) "✓ A-" else "A-"
                        "medium" -> if (active) "✓ A" else "A"
                        "large" -> if (active) "✓ A+" else "A+"
                        else -> if (active) "✓ A++" else "A++"
                    }
                    // Intentional selected state: green pill + green text.
                    // Inactive pills stay quiet white — never a gray wash.
                    b.background = getDrawable(
                        if (active) R.drawable.btn_ghost_selected else R.drawable.btn_ghost)
                    b.setTextColor(getColor(
                        if (active) R.color.green_dark else R.color.text_dark))
                }
            }
            markSize()
            for ((k, b) in sizeBtns) {
                b.setOnClickListener {
                    Store.fontSize = k
                    // Fresh server copy first (see Api.updateUserData): saving
                    // the stale local cache whole would overwrite a newer
                    // profile saved from the website.
                    Api.updateUserData({ data -> data.fontSize = k })
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
            // The CV may have been uploaded from the website since this app
            // last fetched it — refresh from the server so the status here
            // shows the real CV, not a stale local cache.
            if (Store.isLoggedIn) Api.refreshUserData { refreshCvState() }
            findViewById<Button>(R.id.cvBtn).setOnClickListener {
                if (!Store.isLoggedIn) {
                    Ui.toast(this, "CV আপলোড করতে আগে লগইন করুন।")
                    safeStart(Intent(this, LoginActivity::class.java))
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
                // Fresh server copy first (see Api.updateUserData): the CV
                // snapshot to remove may live only on the server (uploaded
                // from the website) — removing from a stale local cache
                // would do nothing, or wipe the wrong fields.
                Api.updateUserData({ d ->
                    val snap = d.profile.cv?.fields ?: emptyMap()
                    d.profile = CvParse.removeCvFields(d.profile, snap)
                })
                cvStatus.text = "CV মুছে ফেলা হয়েছে — প্রোফাইল থেকে CV-র তথ্য সরানো হয়েছে।"
                refreshCvState()
            }

            // ---------- push notifications (v1.1.7) ----------
            // profile.pushEnabled (default on) — the server worker only sends
            // a push when this is on. The toggle saves even while FCM is
            // dormant (no google-services.json yet): the choice is stored and
            // takes effect as soon as the Firebase setup is done.
            val pushYes = findViewById<ToggleButton>(R.id.pushYes)
            val pushNo = findViewById<ToggleButton>(R.id.pushNo)
            val pushStatus = findViewById<TextView>(R.id.pushStatus)
            val markPush = { enabled: Boolean ->
                pushYes.isChecked = enabled
                pushNo.isChecked = !enabled
                pushYes.background = getDrawable(
                    if (enabled) R.drawable.btn_ghost_selected else R.drawable.btn_ghost)
                pushNo.background = getDrawable(
                    if (!enabled) R.drawable.btn_ghost_selected else R.drawable.btn_ghost)
                pushYes.setTextColor(getColor(
                    if (enabled) R.color.green_dark else R.color.text_dark))
                pushNo.setTextColor(getColor(
                    if (!enabled) R.color.green_dark else R.color.text_dark))
                pushStatus.text = if (!PushHelper.isFcmConfigured(this)) {
                    "পুশ নোটিফিকেশন এখনো চালু হয়নি — Firebase সেটআপ বাকি আছে। আপনার পছন্দটি সেভ থাকবে; সেটআপ শেষ হলে নোটিফিকেশন আসবে।"
                } else if (enabled) {
                    "পুশ নোটিফিকেশন চালু আছে — নতুন সার্কুলার ও ডেডলাইন রিমাইন্ডার ফোনে আসবে।"
                } else {
                    "পুশ নোটিফিকেশন বন্ধ আছে।"
                }
            }
            markPush(Store.cachedData.profile.pushEnabled)
            if (Store.isLoggedIn) Api.refreshUserData { markPush(Store.cachedData.profile.pushEnabled) }
            val setPush = { enabled: Boolean ->
                if (!Store.isLoggedIn) {
                    Ui.toast(this, "পুশ সেটিং বদলাতে আগে লগইন করুন।")
                    safeStart(Intent(this, LoginActivity::class.java))
                } else {
                    markPush(enabled)
                    // Android 13+: ask for the notification permission when
                    // switching push on (no popup on older Android).
                    if (enabled && !PushHelper.hasNotificationPermission(this) &&
                        android.os.Build.VERSION.SDK_INT >= 33
                    ) {
                        requestPermissions(
                            arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                            RC_PUSH_NOTIF
                        )
                    }
                    PushHelper.setPushEnabled(this, enabled) { ok ->
                        if (!ok) {
                            pushStatus.text = "সেভ হয়নি — ইন্টারনেট দেখে আবার চাপুন।"
                            markPush(Store.cachedData.profile.pushEnabled)
                        } else {
                            Ui.toast(
                                this,
                                if (enabled) "পুশ নোটিফিকেশন চালু হয়েছে।"
                                else "পুশ নোটিফিকেশন বন্ধ হয়েছে।"
                            )
                        }
                    }
                }
            }
            pushYes.setOnClickListener { setPush(true) }
            pushNo.setOnClickListener { setPush(false) }

            // ---------- app version + update ----------
            findViewById<TextView>(R.id.versionText).text =
                "Job Tracker v${Api.installedVersionName(this)} (নেটিভ অ্যাপ)"
            findViewById<Button>(R.id.checkUpdateBtn).setOnClickListener {
                updateStatus.text = "আপডেট চেক হচ্ছে…"
                UpdateChecker.check(this, onNewVersion = { name, _ ->
                    updateStatus.text = "🔔 নতুন আপডেট এসেছে (v$name) — ডাউনলোড করতে হোমের ব্যানারের বোতাম চাপুন।"
                }, onUpToDate = {
                    updateStatus.text = "✓ সর্বশেষ সংস্করণ ব্যবহার করছেন (v${Api.installedVersionName(this)})।"
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
        } catch (t: Throwable) {
            Ui.toast(this, "সেটিংস খোলা যায়নি — আবার চেষ্টা করুন।")
            finish()
        }
    }

    /** Launch a screen without ever killing the app (see MainActivity). */
    private fun safeStart(intent: Intent): Boolean {
        return try {
            startActivity(intent)
            true
        } catch (t: Throwable) {
            Ui.toast(this, "খোলা যায়নি — আবার চেষ্টা করুন।")
            false
        }
    }

    private fun refreshCvState() {
        val cv = Store.cachedData.profile.cv
        if (cv != null && cv.name.isNotBlank()) {
            cvStatus.setTextColor(getColor(R.color.text_dark))
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
                    ?: run {
                        cvStatus.setTextColor(getColor(R.color.danger))
                        cvStatus.text = "CV পড়া যায়নি — অন্য ফাইল চেষ্টা করুন।"
                        return
                    }
                val mime = contentResolver.getType(uri)
                val name = displayName(uri) ?: "cv"
                val isPdf = mime == "application/pdf" || name.lowercase().endsWith(".pdf")
                val lowerName = name.lowercase()
                val isImage = (mime?.startsWith("image/") == true) ||
                    lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") ||
                    lowerName.endsWith(".png") || lowerName.endsWith(".webp") ||
                    lowerName.endsWith(".bmp")
                if (isImage) {
                    // Image CV — on-device Tesseract OCR (v1.1.7, OcrHelper:
                    // eng+ben, no network). OCR runs off the UI thread; the
                    // recognised text then fills the profile exactly like a
                    // PDF CV does (saveCvText below).
                    if (!OcrHelper.isAvailable()) {
                        cvStatus.setTextColor(getColor(R.color.danger))
                        cvStatus.text = "এই ফোনে ছবির OCR চালু হয়নি (৬৪-বিট ফোন লাগবে) — PDF বা টেক্সট CV দিন, অথবা ওয়েবসাইট দিয়ে আপলোড করুন।"
                        return
                    }
                    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    if (bmp == null) {
                        cvStatus.setTextColor(getColor(R.color.danger))
                        cvStatus.text = "CV পড়া যায়নি — অন্য ফাইল চেষ্টা করুন।"
                        return
                    }
                    cvStatus.setTextColor(getColor(R.color.text_dark))
                    cvStatus.text = "ছবি পড়া হচ্ছে (OCR)…"
                    thread {
                        // First OCR use downloads eng+ben traineddata
                        // once from the site (not bundled in the APK —
                        // see OcrHelper); cached afterwards, so this
                        // runs only the first time.
                        val prep = OcrHelper.prepare(this, onDownloadStart = {
                            runOnUiThread {
                                cvStatus.setTextColor(getColor(R.color.text_dark))
                                cvStatus.text = "OCR-এর ডেটা ডাউনলোড হচ্ছে (প্রথমবার, একবারই)…"
                            }
                        })
                        if (prep != OcrHelper.PrepStatus.READY) {
                            runOnUiThread {
                                cvStatus.setTextColor(getColor(R.color.danger))
                                cvStatus.text = if (prep == OcrHelper.PrepStatus.DOWNLOAD_FAILED)
                                    "ইন্টারনেট নেই — OCR-এর ডেটা ডাউনলোড হয়নি। ইন্টারনেট চালু করে আবার চেষ্টা করুন।"
                                else
                                    NO_TEXT_MSG
                            }
                            return@thread
                        }
                        val ocrText = OcrHelper.ocrBitmap(this, bmp)
                        runOnUiThread {
                            if (ocrText.isNullOrBlank()) {
                                cvStatus.setTextColor(getColor(R.color.danger))
                                cvStatus.text = NO_TEXT_MSG
                                return@runOnUiThread
                            }
                            saveCvText(ocrText, name, bytes.size.toLong())
                        }
                    }
                    return
                }
                val text: String?
                if (isPdf) {
                    // PdfBox-Android দিয়ে পড়া (Word-এর PDF, ASCII85+Flate,
                    // hex-string/ToUnicode — সব পারে); লেখার লেয়ার না থাকলে
                    // (স্ক্যান করা ছবির PDF) আলাদা বার্তা দেখাই।
                    val (pdfText, status) = CvParse.extractPdf(bytes, this)
                    if (status == CvParse.PdfStatus.NO_TEXT_LAYER) {
                        cvStatus.setTextColor(getColor(R.color.danger))
                        cvStatus.text = NO_TEXT_MSG
                        return
                    }
                    text = pdfText
                } else {
                    text = CvParse.extractText(bytes, mime, name)
                }
                if (text == null) {
                    cvStatus.setTextColor(getColor(R.color.danger))
                    cvStatus.text = "ছবির CV থেকে লেখা পড়া যায়নি — PDF বা টেক্সট CV দিন।"
                    return
                }
                saveCvText(text, name, bytes.size.toLong())
            } catch (e: Exception) {
                cvStatus.setTextColor(getColor(R.color.danger))
                cvStatus.text = "CV পড়া যায়নি — অন্য ফাইল চেষ্টা করুন।"
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == RC_PUSH_NOTIF) {
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                findViewById<TextView>(R.id.pushStatus).text =
                    "ফোনের নোটিফিকেশন পারমিশন না দিলে পুশ এলেও দেখাবে না — ফোনের সেটিংস থেকে পরে চালু করতে পারবেন।"
            }
        }
    }

    /** Parse CV text and fill the profile A–Z (same for PDF, text and
     * image-OCR text). The CV wins on every field it contains. */
    private fun saveCvText(text: String, name: String, size: Long) {
        if (text.isBlank()) {
            cvStatus.setTextColor(getColor(R.color.danger))
            cvStatus.text = "CV থেকে লেখা পাওয়া যায়নি — অন্য ফাইল চেষ্টা করুন।"
            return
        }
        val fields = CvParse.parseCvText(text)
        // Fresh server copy first (see Api.updateUserData): the CV
        // fields must land on the newest profile (e.g. one filled
        // on the website), not on a stale local cache — otherwise
        // this save would wipe the website's profile.
        Api.refreshUserData {
            if (!Store.isLoggedIn) {
                cvStatus.setTextColor(getColor(R.color.danger))
                cvStatus.text = "লগইন মেয়াদ শেষ — আবার লগইন করে CV আপলোড করুন।"
                return@refreshUserData
            }
            val d = Store.cachedData
            // CV-ই শেষ কথা: CV-তে যা আছে তা-ই প্রোফাইলে বসবে, আগের মান
            // থাকলেও CV-র মান জিতবে (ওয়েবসাইটের applyCvFieldsToProfile
            // এখন overwriteCvFields ব্যবহার করে)।
            val (merged, filled) = CvParse.overwriteCvFields(d.profile, fields)
            val fieldsStr = fields.mapValues { it.value.toString() }
            merged.cv = CvInfo(
                name = name,
                size = size,
                uploadedAt = System.currentTimeMillis(),
                text = text.take(4000),
                fields = fieldsStr
            )
            d.profile = merged
            Store.cachedData = d
            Api.saveUserData(d)
            refreshCvState()
            cvStatus.setTextColor(getColor(R.color.green_dark))
            cvStatus.text = if (filled.isEmpty()) {
                "CV আপলোড হয়েছে — কোনো তথ্য মেলেনি, প্রোফাইলে নিজে বসান।"
            } else {
                val labels = filled.mapNotNull { CvParse.FIELD_LABELS[it] }
                "CV আপলোড হয়েছে — প্রোফাইলে বসেছে: ${labels.joinToString(", ")}।"
            }
        }
    }

    override fun onNavigateUp(): Boolean {
        finish()
        return true
    }
}
