package com.jobtrackerbd.app

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Spinner
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
    private lateinit var pEdu: Spinner
    private lateinit var pTypeBn: EditText
    private lateinit var pTypeEn: EditText
    private lateinit var pAddress: EditText
    private lateinit var pNotes: EditText
    private lateinit var photoPreview: ImageView
    private lateinit var remYes: ToggleButton
    private lateinit var remNo: ToggleButton
    private lateinit var remNote: TextView
    private lateinit var statusTv: TextView

    private val eduOptions = listOf("HSC", "SSC", "স্নাতক", "JSC")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
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
        pEdu = findViewById(R.id.pEdu)
        pTypeBn = findViewById(R.id.pTypeBn)
        pTypeEn = findViewById(R.id.pTypeEn)
        pAddress = findViewById(R.id.pAddress)
        pNotes = findViewById(R.id.pNotes)
        photoPreview = findViewById(R.id.photoPreview)
        remYes = findViewById(R.id.remYes)
        remNo = findViewById(R.id.remNo)
        remNote = findViewById(R.id.remNote)
        statusTv = findViewById(R.id.status)

        pEdu.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_dropdown_item, eduOptions
        )
        findViewById<Button>(R.id.photoBtn).setOnClickListener {
            val i = Intent(Intent.ACTION_GET_CONTENT).apply { type = "image/*" }
            startActivityForResult(Intent.createChooser(i, "ছবি বেছে নিন"), PICK_PHOTO)
        }

        remYes.setOnClickListener { setRemToggle(true) }
        remNo.setOnClickListener { setRemToggle(false) }

        buildPrefChips()
        loadProfile()
        findViewById<Button>(R.id.saveProfileBtn).setOnClickListener { saveProfile() }
        Ui.applyTextScale(findViewById(android.R.id.content))
    }

    private fun setRemToggle(enabled: Boolean) {
        remindersEnabled = enabled
        remYes.isChecked = enabled
        remNo.isChecked = !enabled
        remNote.text = if (enabled) {
            "হ্যাঁ — ডেডলাইনের রিমাইন্ডার আপনার Gmail-এ যাবে (নিচের পছন্দ অনুযায়ী)।"
        } else {
            "না — কোনো রিমাইন্ডার ইমেইল যাবে না। চাইলে পরে আবার হ্যাঁ করতে পারবেন।"
        }
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
        pEdu.setSelection(eduOptions.indexOf(p.edu).takeIf { it >= 0 } ?: 0)
        pTypeBn.setText(p.typeBn.toString())
        pTypeEn.setText(p.typeEn.toString())
        pAddress.setText(p.address)
        pNotes.setText(p.notes)
        photoDataUrl = p.photo
        showPhoto()
        selTypes.clear()
        selTypes.addAll(p.remTypes)
        selQuals.clear()
        selQuals.addAll(p.remQuals)
        syncChipStates()
        setRemToggle(p.remindersEnabled)
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
        val p = Profile(
            name = pName.text.toString().trim(),
            address = pAddress.text.toString().trim(),
            phone = pPhone.text.toString().trim(),
            photo = photoDataUrl,
            district = pDistrict.text.toString().trim(),
            dob = pDob.text.toString().trim(),
            edu = eduOptions.getOrNull(pEdu.selectedItemPosition) ?: "HSC",
            typeBn = pTypeBn.text.toString().toIntOrNull() ?: 20,
            typeEn = pTypeEn.text.toString().toIntOrNull() ?: 20,
            notes = pNotes.text.toString().trim(),
            remindersEnabled = remindersEnabled,
            remTypes = selTypes.toList(),
            remQuals = selQuals.toList()
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
