package com.jobtrackerbd.app

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ToggleButton
import android.widget.Toolbar
import java.io.ByteArrayOutputStream

/**
 * My Profile — native screen, separate from Settings.
 * Same fields + reminder preferences as the website (profile.html):
 * profile.remindersEnabled (default true) + profile.reminders {types, quals}.
 */
class ProfileActivity : Activity() {

    private val PICK_PHOTO = 1001
    private var photoDataUrl: String = ""
    private var remindersEnabled: Boolean = true
    private val selTypes = mutableSetOf<String>()
    private val selQuals = mutableSetOf<String>()

    private lateinit var pName: EditText
    private lateinit var pPhone: EditText
    private lateinit var pDistrict: EditText
    private lateinit var pDob: EditText
    private lateinit var pEduBtn: Button
    private lateinit var pTypeBn: EditText
    private lateinit var pTypeEn: EditText
    private lateinit var pAddress: EditText
    private lateinit var pNotes: EditText
    private lateinit var pEmail: EditText
    private lateinit var pPermAddress: EditText
    private lateinit var pFatherName: EditText
    private lateinit var pMotherName: EditText
    private lateinit var pSkills: EditText
    private lateinit var pExperience: EditText
    private lateinit var pLanguages: EditText
    private lateinit var photoPreview: ImageView
    private lateinit var remYes: ToggleButton
    private lateinit var remNo: ToggleButton
    private lateinit var statusTv: TextView
    private lateinit var cvInfo: TextView
    private lateinit var removeCvBtnProfile: Button
    private lateinit var resetProfileBtn: Button
    private var resetArmed: Boolean = false
    private var cvRemoveArmed: Boolean = false
    private var eduSelected: String = "HSC"

    private val eduOptions = listOf("HSC", "SSC", "স্নাতক", "JSC")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        // Safety net (v1.1.7 hotfix): if any step of opening this screen
        // throws on a device, show a message and go back instead of
        // the app being killed ("বের করে দেয়").
        try {
            if (!Store.isLoggedIn) {
                startActivity(Intent(this, LoginActivity::class.java))
                finish()
                return
            }
            setContentView(R.layout.activity_profile)
            val toolbar = findViewById<Toolbar>(R.id.toolbar)
            setActionBar(toolbar)
            actionBar?.setDisplayHomeAsUpEnabled(true)
            toolbar.setNavigationOnClickListener { finish() }

            pName = findViewById(R.id.pName)
            pPhone = findViewById(R.id.pPhone)
            pDistrict = findViewById(R.id.pDistrict)
            pDob = findViewById(R.id.pDob)
            pEduBtn = findViewById(R.id.pEduBtn)
            pTypeBn = findViewById(R.id.pTypeBn)
            pTypeEn = findViewById(R.id.pTypeEn)
            pAddress = findViewById(R.id.pAddress)
            pNotes = findViewById(R.id.pNotes)
            pEmail = findViewById(R.id.pEmail)
            pPermAddress = findViewById(R.id.pPermAddress)
            pFatherName = findViewById(R.id.pFatherName)
            pMotherName = findViewById(R.id.pMotherName)
            pSkills = findViewById(R.id.pSkills)
            pExperience = findViewById(R.id.pExperience)
            pLanguages = findViewById(R.id.pLanguages)
            photoPreview = findViewById(R.id.photoPreview)
            remYes = findViewById(R.id.remYes)
            remNo = findViewById(R.id.remNo)
            statusTv = findViewById(R.id.status)
            cvInfo = findViewById(R.id.cvInfo)
            removeCvBtnProfile = findViewById(R.id.removeCvBtnProfile)
            resetProfileBtn = findViewById(R.id.resetProfileBtn)

            // CV remove from the profile screen (same as the website's
            // profile page): two-tap confirm, only snapshot-matching fields
            // are cleared, hand-edited fields stay.
            removeCvBtnProfile.setOnClickListener {
                if (!cvRemoveArmed) {
                    cvRemoveArmed = true
                    removeCvBtnProfile.text = "নিশ্চিত মুছবেন?"
                    Handler(Looper.getMainLooper()).postDelayed({
                        cvRemoveArmed = false
                        removeCvBtnProfile.text = "🗑️ CV মুছুন (Remove CV)"
                    }, 3000)
                    return@setOnClickListener
                }
                cvRemoveArmed = false
                removeCvBtnProfile.text = "🗑️ CV মুছুন (Remove CV)"
                // Fresh server copy first (see Api.updateUserData): the CV
                // snapshot may live only on the server (uploaded from the
                // website) — removing from a stale local cache would do
                // nothing, or wipe the wrong fields.
                // fillFromProfile runs in the callback: updateUserData is
                // async (it refreshes first).
                Api.updateUserData({ d ->
                    val snap = d.profile.cv?.fields ?: emptyMap()
                    d.profile = CvParse.removeCvFields(d.profile, snap)
                }) { fillFromProfile(Store.cachedData.profile) }
                Ui.toast(this, "CV মুছে ফেলা হয়েছে।")
            }

            // Profile reset (same as the website's resetProfileBtn): only the
            // profile + CV are cleared to empty defaults — login/account,
            // shortlist and application status are never touched.
            resetProfileBtn.setOnClickListener {
                if (!resetArmed) {
                    resetArmed = true
                    resetProfileBtn.text = "নিশ্চিত রিসেট করবেন?"
                    Handler(Looper.getMainLooper()).postDelayed({
                        resetArmed = false
                        resetProfileBtn.text = "↺ প্রোফাইল রিসেট করুন (Reset Profile)"
                    }, 3000)
                    return@setOnClickListener
                }
                resetArmed = false
                resetProfileBtn.text = "↺ প্রোফাইল রিসেট করুন (Reset Profile)"
                // Fresh server copy first (see Api.updateUserData) so the
                // reset only clears the profile — shortlist/status stay,
                // and a stale cache cannot resurrect old values.
                Api.updateUserData({ data -> data.profile = Profile() }) {
                    fillFromProfile(Store.cachedData.profile)
                }
                Ui.toast(this, "প্রোফাইল রিসেট হয়েছে।")
            }

            // Education: clean dropdown button (single ▼), same as the home
            // filter dropdowns — no OEM spinner chrome anywhere in the app.
            pEduBtn.setOnClickListener {
                val pm = android.widget.PopupMenu(this, pEduBtn)
                for ((i, e) in eduOptions.withIndex()) pm.menu.add(0, i, 0, e)
                pm.setOnMenuItemClickListener { item ->
                    eduSelected = eduOptions[item.itemId]
                    pEduBtn.text = "$eduSelected ▼"
                    true
                }
                pm.show()
            }
            findViewById<Button>(R.id.photoBtn).setOnClickListener {
                val i = Intent(Intent.ACTION_GET_CONTENT).apply { type = "image/*" }
                try {
                    startActivityForResult(Intent.createChooser(i, "ছবি বেছে নিন"), PICK_PHOTO)
                } catch (t: Throwable) {
                    Ui.toast(this, "ছবি বাছাই খোলা যায়নি।")
                }
            }

            remYes.setOnClickListener { setRemToggle(true) }
            remNo.setOnClickListener { setRemToggle(false) }

            buildPrefChips()
            loadProfile()
            findViewById<Button>(R.id.saveProfileBtn).setOnClickListener { saveProfile() }
            Ui.applyTextScale(findViewById(android.R.id.content))
        } catch (t: Throwable) {
            Ui.toast(this, "প্রোফাইল খোলা যায়নি — আবার চেষ্টা করুন।")
            finish()
        }
    }

    private fun setRemToggle(enabled: Boolean) {
        remindersEnabled = enabled
        remYes.isChecked = enabled
        remNo.isChecked = !enabled
    }

    private fun buildPrefChips() {
        val boxT = findViewById<LinearLayout>(R.id.prefTypes)
        for ((key, label) in ReminderOptions.TYPES) {
            val b = Ui.chipButton(this, label, false)
            b.setOnClickListener {
                if (selTypes.contains(key)) selTypes.remove(key) else selTypes.add(key)
                b.isChecked = selTypes.contains(key)
            }
            boxT.addView(b)
        }
        val boxQ = findViewById<LinearLayout>(R.id.prefQuals)
        for ((key, label) in ReminderOptions.QUALS) {
            val b = Ui.chipButton(this, label, false)
            b.setOnClickListener {
                if (selQuals.contains(key)) selQuals.remove(key) else selQuals.add(key)
                b.isChecked = selQuals.contains(key)
            }
            boxQ.addView(b)
        }
    }

    private fun syncChipStates() {
        val boxT = findViewById<LinearLayout>(R.id.prefTypes)
        for (i in 0 until boxT.childCount) {
            val b = boxT.getChildAt(i) as? ToggleButton ?: continue
            b.isChecked = selTypes.contains(ReminderOptions.TYPES[i].first)
        }
        val boxQ = findViewById<LinearLayout>(R.id.prefQuals)
        for (i in 0 until boxQ.childCount) {
            val b = boxQ.getChildAt(i) as? ToggleButton ?: continue
            b.isChecked = selQuals.contains(ReminderOptions.QUALS[i].first)
        }
    }

    private fun loadProfile() {
        val p = Store.cachedData.profile
        fillFromProfile(p)
        // Refresh from the server in the background (server copy is the truth).
        Api.loadUserData { data ->
            if (data != null) {
                Store.cachedData = data
                fillFromProfile(data.profile)
            }
        }
    }

    private fun fillFromProfile(p: Profile) {
        pName.setText(p.name)
        pPhone.setText(p.phone)
        pDistrict.setText(p.district)
        pDob.setText(p.dob)
        eduSelected = p.edu.ifBlank { "HSC" }
        pEduBtn.text = "$eduSelected ▼"
        pTypeBn.setText(p.typeBn.toString())
        pTypeEn.setText(p.typeEn.toString())
        pAddress.setText(p.address)
        pNotes.setText(p.notes)
        pEmail.setText(p.email)
        pPermAddress.setText(p.permAddress)
        pFatherName.setText(p.fatherName)
        pMotherName.setText(p.motherName)
        pSkills.setText(p.skills)
        pExperience.setText(p.experience)
        pLanguages.setText(p.languages)
        photoDataUrl = p.photo
        showPhoto()
        selTypes.clear()
        selTypes.addAll(p.remTypes)
        selQuals.clear()
        selQuals.addAll(p.remQuals)
        syncChipStates()
        setRemToggle(p.remindersEnabled)
        refreshCvState(p)
    }

    private fun refreshCvState(p: Profile) {
        val cv = p.cv
        if (cv != null && cv.name.isNotBlank()) {
            cvInfo.text = "📄 ${cv.name}"
            removeCvBtnProfile.visibility = View.VISIBLE
        } else {
            cvInfo.text = "📄 আমার CV — এখনো কোনো CV আপলোড করা হয়নি।"
            removeCvBtnProfile.visibility = View.GONE
        }
    }

    private fun showPhoto() {
        if (photoDataUrl.isBlank()) {
            photoPreview.visibility = View.GONE
            return
        }
        try {
            val b64 = photoDataUrl.substringAfter("base64,", "")
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            photoPreview.setImageBitmap(bmp)
            photoPreview.visibility = View.VISIBLE
        } catch (e: Exception) {
            photoPreview.visibility = View.GONE
        }
    }

    private fun saveProfile() {
        // Fresh server copy first (see Api.updateUserData): the form
        // values must land on the newest profile (e.g. a CV filled on
        // the website), not on a stale local cache.
        Api.refreshUserData {
            if (!Store.isLoggedIn) {
                statusTv.text = "লগইন মেয়াদ শেষ — আবার লগইন করে সেভ করুন।"
                return@refreshUserData
            }
            saveProfileOnFreshCache()
        }
    }

    private fun saveProfileOnFreshCache() {
        // copy() keeps the saved CV snapshot (p.cv) — rebuilding a fresh
        // Profile here would wipe the CV on every profile save.
        val p = Store.cachedData.profile.copy(
            name = pName.text.toString().trim(),
            address = pAddress.text.toString().trim(),
            phone = pPhone.text.toString().trim(),
            photo = photoDataUrl,
            district = pDistrict.text.toString().trim(),
            dob = pDob.text.toString().trim(),
            edu = eduSelected,
            typeBn = pTypeBn.text.toString().toIntOrNull() ?: 20,
            typeEn = pTypeEn.text.toString().toIntOrNull() ?: 20,
            notes = pNotes.text.toString().trim(),
            remindersEnabled = remindersEnabled,
            remTypes = selTypes.toList(),
            remQuals = selQuals.toList(),
            email = pEmail.text.toString().trim(),
            permAddress = pPermAddress.text.toString().trim(),
            fatherName = pFatherName.text.toString().trim(),
            motherName = pMotherName.text.toString().trim(),
            skills = pSkills.text.toString().trim(),
            experience = pExperience.text.toString().trim(),
            languages = pLanguages.text.toString().trim()
        )
        val data = Store.cachedData
        data.profile = p
        Store.cachedData = data
        statusTv.text = "সেভ হচ্ছে…"
        Api.saveUserData(data) { ok ->
            if (ok) {
                Ui.toast(this, "✓ প্রোফাইল সেভ হয়েছে।")
                finish()
            } else {
                statusTv.text = "সেভ হয়নি — ইন্টারনেট দেখে আবার চাপুন।"
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == PICK_PHOTO && resultCode == RESULT_OK) {
            val uri: Uri = data?.data ?: return
            val dataUrl = downscaleToDataUrl(uri)
            if (dataUrl == null) {
                Ui.toast(this, "ছবি পড়া যায়নি — অন্য ছবি চেষ্টা করুন।")
                return
            }
            photoDataUrl = dataUrl
            showPhoto()
            Ui.toast(this, "ছবি বেছে নেওয়া হয়েছে — সেভ করলে প্রোফাইলে যাবে।")
        }
    }

    /** Downscale to a small JPEG data URL (server cap is ~200 KB of text). */
    private fun downscaleToDataUrl(uri: Uri): String? {
        return try {
            val input = contentResolver.openInputStream(uri) ?: return null
            val raw = BitmapFactory.decodeStream(input)
            input.close()
            if (raw == null) return null
            var size = 480
            var quality = 70
            var out: String? = null
            while (size >= 200) {
                val scale = size.toFloat() / maxOf(raw.width, raw.height).toFloat()
                val w = maxOf(1, (raw.width * scale).toInt())
                val h = maxOf(1, (raw.height * scale).toInt())
                val bmp = Bitmap.createScaledBitmap(raw, w, h, true)
                val baos = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, quality, baos)
                val b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
                val candidate = "data:image/jpeg;base64,$b64"
                if (candidate.length < 190000) {
                    out = candidate
                    break
                }
                size -= 120
                quality -= 15
            }
            out
        } catch (e: Exception) {
            null
        }
    }

    override fun onNavigateUp(): Boolean {
        finish()
        return true
    }
}
