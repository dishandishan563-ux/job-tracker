package com.jobtrackerbd.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toolbar
import org.json.JSONObject

/** Native details screen for one circular. */
class DetailActivity : Activity() {

    private lateinit var circular: Circular
    private lateinit var cdText: TextView
    private lateinit var statusText: TextView
    private lateinit var shortlistBtn: Button
    private val tickHandler = Handler(Looper.getMainLooper())
    private val tickRunnable = object : Runnable {
        override fun run() {
            cdText.text = Util.countdownText(circular.deadline)
            tickHandler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        val raw = intent.getStringExtra("circular_json") ?: ""
        circular = try {
            Circular.fromJson(JSONObject(raw))
        } catch (e: Exception) {
            finish()
            return
        }
        setContentView(R.layout.activity_detail)
        val toolbar = findViewById<Toolbar>(R.id.toolbar)
        setActionBar(toolbar)
        actionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        findViewById<TextView>(R.id.org).text = circular.org
        findViewById<TextView>(R.id.orgEn).text = circular.orgEn
        findViewById<TextView>(R.id.metaLine).text = listOf(
            circular.typeBn.ifBlank { circular.type },
            if (circular.grade > 0) "গ্রেড ${Util.bn(circular.grade)}" else "",
            circular.salary,
            if (circular.fee > 0) "ফি ${Util.bn(circular.fee)} টাকা" else "",
            circular.age,
            circular.districts
        ).filter { it.isNotBlank() }.joinToString(" • ")
        findViewById<TextView>(R.id.deadlineLine).text =
            if (circular.deadline.isNotBlank()) "শেষ: ${Util.formatDeadlineBn(circular.deadline)}" else ""
        cdText = findViewById(R.id.cdText)
        cdText.text = Util.countdownText(circular.deadline)
        val note = findViewById<TextView>(R.id.sourceNote)
        note.text = if (circular.source == "secondary") {
            circular.sourceNote.ifBlank { "দ্বিতীয় সূত্রের তথ্য — আবেদনের আগে অফিসিয়াল সার্কুলার যাচাই করুন।" }
        } else "অফিসিয়াল সার্কুলার।"
        if (circular.autoAdded) {
            note.text = "${note.text} (Teletalk-এর সরকারি তালিকা থেকে যোগ হয়েছে।)"
        }

        val postsBox = findViewById<LinearLayout>(R.id.postsBox)
        if (circular.posts.isEmpty()) {
            val t = TextView(this)
            t.text = "পদের বিস্তারিত তথ্য দেওয়া নেই — মোট ${Util.bn(circular.totalPosts)}টি পদ।"
            t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            t.setLineSpacing(0f, 1.15f)
            postsBox.addView(t)
        } else {
            for (p in circular.posts) {
                val t = TextView(this)
                t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                t.setLineSpacing(0f, 1.15f)
                val typing = buildString {
                    if (p.typingBn > 0 || p.typingEn > 0) {
                        append(" — টাইপিং বাংলা ${Util.bn(p.typingBn)} + ইংরেজি ${Util.bn(p.typingEn)}")
                    }
                    if (p.shorthandBn > 0 || p.shorthandEn > 0) {
                        append(" — শর্টহ্যান্ড বাংলা ${Util.bn(p.shorthandBn)} + ইংরেজি ${Util.bn(p.shorthandEn)}")
                    }
                }
                // Auto-added circulars have no qualification/grade data
                // (null in the API): show only the parts that exist, so
                // the line never reads "• মালী — ১টি (, গ্রেড ০)".
                t.text = buildString {
                    append("• ${p.title}")
                    if (p.count > 0) append(" — ${Util.bn(p.count)}টি")
                    val inner = listOf(
                        p.qualification,
                        if (p.grade > 0) "গ্রেড ${Util.bn(p.grade)}" else ""
                    ).filter { it.isNotBlank() }.joinToString(", ")
                    if (inner.isNotBlank()) append(" ($inner)")
                    append(typing)
                }
                t.setPadding(0, 6, 0, 6)
                postsBox.addView(t)
            }
        }

        statusText = findViewById(R.id.statusText)
        val bApplied = findViewById<Button>(R.id.statusApplied)
        val bFee = findViewById<Button>(R.id.statusFee)
        val bAdmit = findViewById<Button>(R.id.statusAdmit)
        val setStatus = { s: String ->
            // Fresh server copy first — see Api.updateUserData: saving the
            // stale local cache whole would overwrite a newer profile
            // saved from the website. refreshStatus runs in the callback:
            // updateUserData is async (it refreshes first).
            Api.updateUserData({ data ->
                if (data.status[circular.id] == s) data.status.remove(circular.id)
                else data.status[circular.id] = s
            }) { refreshStatus() }
        }
        bApplied.setOnClickListener { setStatus("applied") }
        bFee.setOnClickListener { setStatus("fee_paid") }
        bAdmit.setOnClickListener { setStatus("admit") }
        refreshStatus()

        shortlistBtn = findViewById(R.id.shortlistBtn)
        shortlistBtn.setOnClickListener {
            // Fresh server copy first (see Api.updateUserData), and
            // refreshShortlist runs in the callback — async.
            Api.updateUserData({ data ->
                if (data.shortlist.contains(circular.id)) data.shortlist.remove(circular.id)
                else data.shortlist.add(circular.id)
            }) { refreshShortlist() }
        }
        refreshShortlist()

        findViewById<Button>(R.id.applyBtn).setOnClickListener {
            if (circular.applyUrl.isBlank()) {
                Ui.toast(this, "এই সার্কুলারের আবেদন লিংক দেওয়া নেই।")
            } else {
                Ui.openUrl(this, circular.applyUrl)
            }
        }
        Ui.applyTextScale(findViewById(android.R.id.content))
        tickHandler.post(tickRunnable)
    }

    private fun refreshStatus() {
        val st = Store.cachedData.status[circular.id]
        statusText.text = Ui.statusLabel(st).ifBlank { "এখনো আবেদন করেননি।" }
        // Selected status button shows the intentional green pill; the
        // others stay quiet white — never a gray wash.
        val mark = { id: Int, active: Boolean ->
            findViewById<Button>(id).apply {
                background = getDrawable(
                    if (active) R.drawable.btn_ghost_selected else R.drawable.btn_ghost)
                setTextColor(getColor(
                    if (active) R.color.green_dark else R.color.text_dark))
            }
        }
        mark(R.id.statusApplied, st == "applied")
        mark(R.id.statusFee, st == "fee_paid")
        mark(R.id.statusAdmit, st == "admit")
    }

    private fun refreshShortlist() {
        val saved = Store.cachedData.shortlist.contains(circular.id)
        shortlistBtn.text = if (saved) getString(R.string.saved) else getString(R.string.save_shortlist)
    }

    override fun onDestroy() {
        tickHandler.removeCallbacks(tickRunnable)
        super.onDestroy()
    }

    override fun onNavigateUp(): Boolean {
        finish()
        return true
    }
}
