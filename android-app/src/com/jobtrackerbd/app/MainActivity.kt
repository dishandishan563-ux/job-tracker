package com.jobtrackerbd.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.ToggleButton
import android.widget.Toolbar
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Home — native circular list.
 * Same rules as the website: browse/search/filter without login; Apply,
 * shortlist and details need login (login screen opens instead).
 */
class MainActivity : Activity() {

    private lateinit var listView: ListView
    private lateinit var adapter: CircularAdapter
    private lateinit var heroStats: TextView
    private lateinit var heroCountdown: TextView
    private lateinit var loading: ProgressBar
    private lateinit var emptyView: TextView
    private lateinit var updateBanner: View
    private lateinit var updateText: TextView

    private var all: List<Circular> = emptyList()
    private var contact: JSONObject? = null
    private var creator: Creator = Creator()

    // "তৈরি করেছেন" (Made by) home footer — built once, filled when the
    // server config arrives, hidden entirely while the admin has set
    // nothing (no name, photo or links).
    private var madeByFooter: View? = null
    private var madeByFooterViews: MadeByViews? = null

    // Custom slide-in drawer (right side): the framework overflow menu
    // rendered as a too-wide popup and truncated the long contact label
    // with "..", so the menu is a real drawer panel now — max 320dp /
    // 80% of screen width, 16sp items, long labels wrap to two lines.
    private var drawerRoot: FrameLayout? = null
    private var drawerOpen: Boolean = false

    private var query: String = ""
    private var typeKey: String? = null
    private var qualKey: String? = null
    private var gradeFilter: Int = 0
    private var sortMode: Int = 0 // 0 deadline, 1 posts desc, 2 name A-Z
    private var shortlistOnly: Boolean = false

    // TEMPORARY DIAGNOSTIC (crash-locator build): shows the first launch
    // error on screen once, so a screenshot names the failing step.
    // Remove together with the PushHelper.lastError / Api.lastError code.
    private var diagShown = false
    private var createFailed = false
    private var pendingDiag: String? = null

    private fun diagText(step: String, t: Throwable): String {
        val msg = (t.message ?: "").take(100)
        return "$step (${t.javaClass.simpleName}) — $msg"
    }

    private fun showDiagDialog(text: String) {
        if (diagShown) return
        diagShown = true
        try {
            runOnUiThread {
                try {
                    AlertDialog.Builder(this)
                        .setTitle("⚠️ সমস্যা ধরা পড়েছে")
                        .setMessage(text.take(200))
                        .setPositiveButton("ঠিক আছে", null)
                        .show()
                } catch (t: Throwable) {
                    Ui.toast(this, text.take(100))
                }
            }
        } catch (ignored: Throwable) {
        }
    }

    private val tickHandler = Handler(Looper.getMainLooper())
    private val tickRunnable = object : Runnable {
        override fun run() {
            updateCountdowns()
            tickHandler.postDelayed(this, 1000)
        }
    }
    private val updateHandler = Handler(Looper.getMainLooper())
    private val updateRunnable = object : Runnable {
        override fun run() {
            checkUpdate()
            updateHandler.postDelayed(this, 30 * 60 * 1000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            onCreateInner(savedInstanceState)
        } catch (t: Throwable) {
            // TEMPORARY DIAGNOSTIC: show the real error instead of crashing.
            createFailed = true
            pendingDiag = diagText("Home:", t)
            try { showDiagDialog(pendingDiag!!) } catch (ignored: Throwable) { }
        }
    }

    private fun onCreateInner(savedInstanceState: Bundle?) {
        Store.init(this)
        setContentView(R.layout.activity_main)
        val toolbar = findViewById<Toolbar>(R.id.toolbar)
        setActionBar(toolbar)
        toolbar.setNavigationIcon(R.drawable.ic_menu)
        toolbar.setNavigationOnClickListener { openDrawer() }

        listView = findViewById(R.id.list)
        heroStats = findViewById(R.id.heroStats)
        heroCountdown = findViewById(R.id.heroCountdown)
        loading = findViewById(R.id.loading)
        emptyView = findViewById(R.id.emptyView)
        updateBanner = findViewById(R.id.updateBanner)
        updateText = findViewById(R.id.updateText)

        // Made-by footer must be added BEFORE the adapter is set.
        madeByFooter = buildMadeByFooter()
        listView.addFooterView(madeByFooter)
        adapter = CircularAdapter(
            this, emptyList(),
            onApply = { c -> onApply(c) },
            onShortlist = { c -> onShortlist(c) },
            onOpen = { c -> openDetail(c) }
        )
        listView.adapter = adapter

        findViewById<Button>(R.id.refreshBtn).setOnClickListener { runOnlineCheck() }
        findViewById<Button>(R.id.updateBtn).setOnClickListener {
            UpdateChecker.downloadAndInstall(this) { msg -> Ui.toast(this, msg) }
        }
        findViewById<Button>(R.id.updateDismiss).setOnClickListener {
            updateBanner.visibility = View.GONE
            UpdateChecker.dismissedVersionCode = pendingUpdateCode
        }
        findViewById<EditText>(R.id.searchBox).addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                query = s?.toString()?.trim() ?: ""
                applyFilters()
            }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })

        buildTypeChips()
        buildQualChips()
        setupFilterButtons()
        // Shortlist toggle uses the same clean pill as the chips — no
        // default ToggleButton chrome (groove line / gray circle).
        findViewById<ToggleButton>(R.id.shortlistOnly).apply {
            setButtonDrawable(null)
            background = getDrawable(R.drawable.chip_bg)
            setTextColor(getColorStateList(R.color.chip_text))
        }
        findViewById<ToggleButton>(R.id.shortlistOnly).setOnCheckedChangeListener { _, checked ->
            shortlistOnly = checked
            applyFilters()
        }
        findViewById<Button>(R.id.clearFilters).setOnClickListener { clearFilters() }

        loadCirculars()
        loadConfig()
        tickHandler.post(tickRunnable)
        updateHandler.post(updateRunnable)
    }

    /** GET /api/config — contact links + the Made-by profile (both public,
     * server-side, so every user sees the same thing). Telegram falls back
     * to the contact tab's value when the creator profile has none. */
    private fun loadConfig() {
        Api.fetchConfig { json ->
            contact = json?.optJSONObject("contact")
            val c = Creator.fromJson(json?.optJSONObject("creator"))
            creator = if (c.telegram.isBlank()) {
                c.copy(telegram = contact?.optString("telegram", "") ?: "")
            } else c
            refreshMadeBy()
            invalidateOptionsMenu()
        }
    }

    override fun onResume() {
        super.onResume()
        try {
            onResumeInner()
        } catch (t: Throwable) {
            // TEMPORARY DIAGNOSTIC: show the real error instead of crashing.
            try { showDiagDialog(diagText("Home:", t)) } catch (ignored: Throwable) { }
        }
    }

    private fun onResumeInner() {
        if (createFailed) {
            pendingDiag?.let { showDiagDialog(it); pendingDiag = null }
            return
        }
        // Profile/shortlist may have changed on another screen — re-render.
        // Also re-apply the text-size setting (it may have changed in Settings).
        Ui.applyTextScale(findViewById(android.R.id.content))
        adapter.notifyDataSetChanged()
        updateHero()
        invalidateOptionsMenu()
        checkUpdate()
        loadConfig()
        // Sync with the server on every return to home: the profile/CV may
        // have been changed on the website (same Gmail) since this app
        // last fetched it — without this the home list kept showing the
        // stale local cache forever (no CV, no CV-match badge) until the
        // user logged in again. Offline the cache is kept as-is.
        if (Store.isLoggedIn) {
            Api.refreshUserData {
                try {
                    adapter.notifyDataSetChanged()
                    updateHero()
                } catch (t: Throwable) {
                    showDiagDialog(diagText("Data load:", t))
                }
                // TEMPORARY DIAGNOSTIC: a data-load error is recorded
                // asynchronously — show it when the callback arrives.
                Api.lastError?.let { showDiagDialog(it); Api.clearLastError() }
            }
            // FCM token sync (no-op while FCM is dormant — see PushHelper).
            PushHelper.syncToken(this)
            PushHelper.flushPendingToken(this)
            // TEMPORARY DIAGNOSTIC: show a recorded Push/Firebase error
            // once, so a screenshot names the failing step.
            PushHelper.lastError?.let { showDiagDialog(it); PushHelper.clearLastError() }
        }
    }

    override fun onDestroy() {
        tickHandler.removeCallbacks(tickRunnable)
        updateHandler.removeCallbacks(updateRunnable)
        super.onDestroy()
    }

    private var pendingUpdateCode: Int = -1

    private fun checkUpdate() {
        UpdateChecker.check(this, onNewVersion = { name, code ->
            pendingUpdateCode = code
            updateText.text = "🔔 নতুন আপডেট এসেছে (v$name) — আপডেট করুন (Update)"
            updateBanner.visibility = View.VISIBLE
        })
    }

    // ---------- custom drawer ----------
    // The framework overflow menu rendered as a too-wide popup (~85% of the
    // screen) and truncated the long contact label with "..", so the menu
    // is a real right-side drawer panel now: max 320dp / 80% of the screen,
    // 16sp items with 56dp rows, long labels wrap to two lines — never "..".

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun drawerWidth(): Int =
        minOf(dp(320), (resources.displayMetrics.widthPixels * 0.8).toInt())

    private fun ensureDrawer() {
        if (drawerRoot != null) return
        val root = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            visibility = View.GONE
        }
        val dim = View(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(0x80000000.toInt())
            setOnClickListener { closeDrawer() }
        }
        root.addView(dim)
        (findViewById<View>(android.R.id.content) as ViewGroup).addView(root)
        drawerRoot = root
    }

    private fun openDrawer() {
        ensureDrawer()
        val root = drawerRoot ?: return
        // Rebuild the panel on every open: login state + contact may change.
        // Guard: on the very first open the root holds only the dim view
        // (index 0) — there is no old panel at index 1 yet. Calling
        // removeViewAt(1) unguarded threw IndexOutOfBoundsException and
        // crashed the app on the first ☰ tap (v1.1.2 regression).
        if (root.childCount > 1) root.removeViewAt(1)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            elevation = dp(12).toFloat()
            layoutParams = FrameLayout.LayoutParams(drawerWidth(), ViewGroup.LayoutParams.MATCH_PARENT)
                .apply { gravity = Gravity.END }
            // Header is full-bleed green; the items area keeps 12dp bottom.
            setPadding(0, 0, 0, dp(12))
        }
        // Premium brand header: green gradient, white "JT" badge + app
        // name, and a translucent-white circular ✕ that reads as part of
        // the header — never a flat gray pill.
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = getDrawable(R.drawable.drawer_header_bg)
            setPadding(dp(16), dp(18), dp(12), dp(18))
        }
        val logoBadge = TextView(this).apply {
            text = "JT"
            textSize = 15f
            setTextColor(Color.parseColor("#14532d"))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = getDrawable(R.drawable.drawer_logo_bg)
            layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
        }
        val headTitle = TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 18f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(dp(12), 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val closeBtn = Button(this).apply {
            text = "✕"
            textSize = 16f
            minHeight = 0
            minimumHeight = 0
            minWidth = 0
            minimumWidth = 0
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(dp(36), dp(36))
            background = getDrawable(R.drawable.drawer_close_bg)
            setTextColor(Color.WHITE)
            setOnClickListener { closeDrawer() }
        }
        head.addView(logoBadge)
        head.addView(headTitle)
        head.addView(closeBtn)
        panel.addView(head)

        // Group divider: hairline with side margins, between menu groups.
        fun divider() {
            panel.addView(View(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(1))
                    .apply { setMargins(dp(16), dp(6), dp(16), dp(6)) }
                setBackgroundColor(Color.parseColor("#E5E7EB"))
            })
        }

        fun item(label: String, onClick: () -> Unit) {
            // Every label starts with one emoji ("👤 …", "⚙️ …"): split it
            // into a fixed-width icon column so all text starts at the
            // same x — aligned icons, no ragged edge. Wording unchanged.
            val sp = label.indexOf(' ')
            val icon = if (sp > 0) label.substring(0, sp) else ""
            val text = if (sp > 0) label.substring(sp + 1) else label
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(56)
                setPadding(dp(12), dp(12), dp(12), dp(12))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                    .apply { setMargins(dp(8), dp(2), dp(8), dp(2)) }
                // Intentional states only: pressed = green ripple,
                // selected = green pill. No gray state exists in the
                // drawer (the old ripple left a gray wash on Settings).
                background = getDrawable(R.drawable.drawer_item_bg)
                isClickable = true
                setOnClickListener { closeDrawer(); onClick() }
            }
            val iconView = TextView(this).apply {
                this.text = icon
                textSize = 18f
                gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(dp(28), ViewGroup.LayoutParams.WRAP_CONTENT)
            }
            val labelView = TextView(this).apply {
                this.text = text
                textSize = 16f
                setTextColor(Color.parseColor("#1a1a1a"))
                maxLines = 2
                ellipsize = null
                layoutParams = LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            row.addView(iconView)
            row.addView(labelView)
            panel.addView(row)
        }

        item(getString(R.string.menu_profile)) {
            if (Store.isLoggedIn) safeStart(Intent(this, ProfileActivity::class.java))
            else safeStart(Intent(this, LoginActivity::class.java))
        }
        item(getString(R.string.menu_settings)) {
            safeStart(Intent(this, SettingsActivity::class.java))
        }
        divider()
        val wa = contact?.optString("whatsapp", "") ?: ""
        val tg = contact?.optString("telegram", "") ?: ""
        if (wa.isNotBlank() || tg.isNotBlank()) {
            item(getString(R.string.menu_contact)) { showContactDialog() }
        }
        item(getString(R.string.menu_refresh)) { loadCirculars() }
        divider()
        if (Store.isLoggedIn) {
            item(getString(R.string.menu_logout)) {
                Store.logout()
                Ui.toast(this, "লগআউট হয়েছে।")
                adapter.notifyDataSetChanged()
            }
        } else {
            item(getString(R.string.menu_login)) {
                safeStart(Intent(this, LoginActivity::class.java))
            }
        }
        divider()
        item(getString(R.string.menu_about)) { showAboutDialog() }
        root.addView(panel)
        Ui.applyTextScale(panel)
        root.visibility = View.VISIBLE
        drawerOpen = true
    }

    private fun closeDrawer() {
        drawerRoot?.visibility = View.GONE
        drawerOpen = false
    }

    override fun onBackPressed() {
        if (drawerOpen) { closeDrawer(); return }
        super.onBackPressed()
    }

    private fun showContactDialog() {
        val wa = contact?.optString("whatsapp", "") ?: ""
        val tg = contact?.optString("telegram", "") ?: ""
        val items = mutableListOf<String>()
        if (wa.isNotBlank()) items.add("📱 WhatsApp-এ যোগাযোগ করুন")
        if (tg.isNotBlank()) items.add("✈️ Telegram-এ যোগাযোগ করুন")
        AlertDialog.Builder(this)
            .setTitle("আবেদন করতে চাইলে যোগাযোগ করুন")
            .setItems(items.toTypedArray()) { _, which ->
                val url = if (items[which].contains("WhatsApp")) wa else tg
                Ui.openUrl(this, url)
            }
            .setNegativeButton("বন্ধ", null)
            .show()
    }

    // ---------- "তৈরি করেছেন" (Made by) ----------
    // One builder for both places the section shows: the home-list footer
    // and the About dialog. Photo (circular, green ring) or a "JT"
    // monogram when the admin has not set a photo yet — never a fake
    // photo. Link buttons open in the browser; only set links appear.

    private class MadeByViews(
        val root: LinearLayout,
        val photo: ImageView,
        val mono: TextView,
        val name: TextView,
        val links: LinearLayout
    )

    private fun buildMadeByViews(photoSizeDp: Int, withVersion: Boolean): MadeByViews {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        val title = TextView(this).apply {
            text = getString(R.string.made_by_title)
            textSize = 15f
            setTextColor(Color.parseColor("#1a1a1a"))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        root.addView(title)
        // Photo / monogram: a green circle with a 2dp ring. The photo is
        // circular-cropped in code; the monogram is white "JT" on green.
        val photoWrap = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(photoSizeDp), dp(photoSizeDp))
                .apply { topMargin = dp(10) }
            background = getDrawable(R.drawable.made_by_mono_bg)
            setPadding(dp(2), dp(2), dp(2), dp(2))
        }
        val photo = ImageView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            scaleType = ImageView.ScaleType.CENTER_CROP
            visibility = View.GONE
        }
        val mono = TextView(this).apply {
            text = "JT"
            textSize = (photoSizeDp * 0.32).toFloat()
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        photoWrap.addView(photo)
        photoWrap.addView(mono)
        root.addView(photoWrap)
        val name = TextView(this).apply {
            textSize = 17f
            setTextColor(Color.parseColor("#1a1a1a"))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
            visibility = View.GONE
        }
        root.addView(name)
        if (withVersion) {
            root.addView(TextView(this).apply {
                text = "সংস্করণ v${Api.APP_VERSION_NAME}"
                textSize = 13f
                setTextColor(Color.parseColor("#5f6368"))
                gravity = Gravity.CENTER
                setPadding(0, dp(2), 0, 0)
            })
        }
        val links = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, 0)
        }
        root.addView(links)
        return MadeByViews(root, photo, mono, name, links)
    }

    private fun fillMadeByViews(v: MadeByViews, c: Creator) {
        v.name.text = c.name
        v.name.visibility = if (c.name.isNotBlank()) View.VISIBLE else View.GONE
        v.links.removeAllViews()
        val buttons = listOfNotNull(
            if (c.whatsapp.isNotBlank()) Triple("💬 WhatsApp", c.whatsapp, true) else null,
            if (c.facebook.isNotBlank()) Triple("📘 Facebook", c.facebook, false) else null,
            if (c.telegram.isNotBlank()) Triple("✈️ Telegram", c.telegram, false) else null
        )
        for ((label, url, primary) in buttons) {
            val b = Button(this).apply {
                text = label
                textSize = 13f
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                minHeight = 0
                minimumHeight = 0
                minWidth = 0
                minimumWidth = 0
                setPadding(dp(14), dp(8), dp(14), dp(8))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, dp(40))
                    .apply { setMargins(dp(4), 0, dp(4), 0) }
                background = getDrawable(
                    if (primary) R.drawable.btn_primary else R.drawable.btn_secondary)
                setTextColor(
                    if (primary) Color.WHITE else Color.parseColor("#14532d"))
                setOnClickListener { Ui.openUrl(this@MainActivity, url) }
            }
            v.links.addView(b)
        }
        v.links.visibility = if (buttons.isEmpty()) View.GONE else View.VISIBLE
        loadCreatorPhoto(c.photo, v.photo, v.mono)
    }

    /** Fill the home footer from the server creator; hide it entirely
     * while the admin has set nothing. */
    private fun refreshMadeBy() {
        val footer = madeByFooter ?: return
        val views = madeByFooterViews ?: return
        footer.visibility = if (creator.isEmpty()) View.GONE else View.VISIBLE
        if (creator.isEmpty()) return
        fillMadeByViews(views, creator)
    }

    private fun buildMadeByFooter(): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = getDrawable(R.drawable.card_bg)
            setPadding(dp(4), dp(4), dp(4), dp(4))
            visibility = View.GONE
        }
        val views = buildMadeByViews(64, false)
        madeByFooterViews = views
        card.addView(views.root)
        return card
    }

    private fun showAboutDialog() {
        val views = buildMadeByViews(72, true)
        if (!creator.isEmpty()) fillMadeByViews(views, creator)
        else {
            // Nothing set yet: still show the monogram + version, so the
            // About screen itself answers "who made this".
            views.name.text = "Job Tracker"
            views.name.visibility = View.VISIBLE
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("Job Tracker")
            .setView(views.root)
            .setPositiveButton("ঠিক আছে", null)
            .show()
        Ui.applyTextScale(views.root)
    }

    /** Load the creator photo (base64 data URL or https URL) on a worker
     * thread, circular-crop it, and show it; on any failure the "JT"
     * monogram stays. A blank photo shows the monogram immediately. */
    private fun loadCreatorPhoto(photo: String, imageView: ImageView, monogram: TextView) {
        if (photo.isBlank()) {
            imageView.visibility = View.GONE
            monogram.visibility = View.VISIBLE
            return
        }
        thread {
            val bmp = try {
                if (photo.startsWith("data:image")) {
                    val b64 = photo.substringAfter(",", "")
                    val bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
                    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                } else {
                    val conn = java.net.URL(photo).openConnection() as java.net.HttpURLConnection
                    conn.connectTimeout = 10000
                    conn.readTimeout = 10000
                    conn.inputStream.use { android.graphics.BitmapFactory.decodeStream(it) }
                }
            } catch (e: Exception) {
                null
            }
            val round = bmp?.let { circularBitmap(it) }
            runOnUiThread {
                if (round != null) {
                    imageView.setImageBitmap(round)
                    imageView.visibility = View.VISIBLE
                    monogram.visibility = View.GONE
                } else {
                    imageView.visibility = View.GONE
                    monogram.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun circularBitmap(src: android.graphics.Bitmap): android.graphics.Bitmap {
        val size = minOf(src.width, src.height)
        val out = android.graphics.Bitmap.createBitmap(
            size, size, android.graphics.Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(out)
        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
        val shader = android.graphics.BitmapShader(
            src, android.graphics.Shader.TileMode.CLAMP,
            android.graphics.Shader.TileMode.CLAMP)
        val scale = size.toFloat() / minOf(src.width, src.height)
        val m = android.graphics.Matrix()
        m.setScale(scale, scale)
        m.postTranslate((size - src.width * scale) / 2f, (size - src.height * scale) / 2f)
        shader.setLocalMatrix(m)
        paint.shader = shader
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
        return out
    }

    // ---------- data ----------

    private fun loadCirculars() {
        loading.visibility = View.VISIBLE
        emptyView.visibility = View.GONE
        Api.fetchCirculars { list, err ->
            loading.visibility = View.GONE
            if (list.isEmpty() && err.isNotEmpty()) {
                Ui.toast(this, err)
            }
            all = list
            applyFilters()
            updateHero()
        }
    }

    private fun runOnlineCheck() {
        Ui.toast(this, "নতুন সার্কুলার খোঁজা হচ্ছে…")
        Api.onlineCheck { r ->
            val added = r.json?.optJSONObject("discovered")?.optInt("added", 0) ?: 0
            val msg = if (added > 0) "নতুন ${Util.bn(added)}টি সার্কুলার যোগ হয়েছে।"
                else "নতুন কোনো সার্কুলার পাওয়া যায়নি।"
            Ui.toast(this, msg)
            loadCirculars()
        }
    }

    private fun updateHero() {
        val now = System.currentTimeMillis()
        val open = all.count { (Util.parseDeadlineMs(it.deadline) ?: 0L) > now }
        heroStats.text =
            "সবার জন্য উন্মুক্ত • চলমান ${Util.bn(open)}টি • মোট ${Util.bn(all.size)}টি"
        val nearest = all.mapNotNull { c ->
            Util.parseDeadlineMs(c.deadline)?.let { if (it > now) it to c else null }
        }.minByOrNull { it.first }
        heroCountdown.text = if (nearest != null) {
            "⏰ সবচেয়ে কাছে: ${nearest.second.org} — ${Util.countdownText(nearest.second.deadline, now)}"
        } else ""
    }

    private fun updateCountdowns() {
        val now = System.currentTimeMillis()
        for (i in 0 until listView.childCount) {
            val row = listView.getChildAt(i) ?: continue
            val cd = row.findViewById<TextView>(R.id.cdText) ?: continue
            val iso = cd.tag as? String ?: continue
            if (iso.isBlank()) continue
            cd.text = Util.countdownText(iso, now)
        }
        updateHero()
    }

    // ---------- filters ----------

    private fun buildTypeChips() {
        val box = findViewById<LinearLayout>(R.id.typeChips)
        val allBtn = Ui.chipButton(this, getString(R.string.all_types), true)
        allBtn.setOnClickListener { selectType(null, box) }
        box.addView(allBtn)
        for ((key, label) in ReminderOptions.TYPES) {
            val b = Ui.chipButton(this, label, false)
            b.setOnClickListener { selectType(key, box) }
            box.addView(b)
        }
    }

    private fun selectType(key: String?, box: LinearLayout) {
        typeKey = key
        for (i in 0 until box.childCount) {
            val b = box.getChildAt(i) as? ToggleButton ?: continue
            val isAll = i == 0
            b.isChecked = if (key == null) isAll else (!isAll && ReminderOptions.TYPES.getOrNull(i - 1)?.first == key)
        }
        applyFilters()
    }

    private fun buildQualChips() {
        val box = findViewById<LinearLayout>(R.id.qualChips)
        val allBtn = Ui.chipButton(this, getString(R.string.all_quals), true)
        allBtn.setOnClickListener { selectQual(null, box) }
        box.addView(allBtn)
        for ((key, label) in ReminderOptions.QUALS) {
            val b = Ui.chipButton(this, label, false)
            b.setOnClickListener { selectQual(key, box) }
            box.addView(b)
        }
    }

    private fun selectQual(key: String?, box: LinearLayout) {
        qualKey = key
        for (i in 0 until box.childCount) {
            val b = box.getChildAt(i) as? ToggleButton ?: continue
            val isAll = i == 0
            b.isChecked = if (key == null) isAll else (!isAll && ReminderOptions.QUALS.getOrNull(i - 1)?.first == key)
        }
        applyFilters()
    }

    // ---------- filter dropdowns ----------
    // Plain Button + PopupMenu (single "▼" arrow drawn as part of the
    // label). Spinners are gone: the device spinner chrome rendered a
    // phantom second arrow plus a stray gray circle in this row.
    private fun setupFilterButtons() {
        val sortBtn = findViewById<Button>(R.id.sortBtn)
        sortBtn.setOnClickListener {
            val pm = PopupMenu(this, sortBtn)
            pm.menu.add(0, 0, 0, getString(R.string.sort_deadline))
            pm.menu.add(0, 1, 0, getString(R.string.sort_posts))
            pm.menu.add(0, 2, 0, getString(R.string.sort_name))
            pm.setOnMenuItemClickListener { item ->
                sortMode = item.itemId
                updateFilterButtonLabels()
                applyFilters()
                true
            }
            pm.show()
        }
        val gradeBtn = findViewById<Button>(R.id.gradeBtn)
        gradeBtn.setOnClickListener {
            val pm = PopupMenu(this, gradeBtn)
            pm.menu.add(0, 0, 0, getString(R.string.all_grades))
            pm.menu.add(0, 1, 0, "১৩")
            pm.menu.add(0, 2, 0, "১৬")
            pm.menu.add(0, 3, 0, "২০")
            pm.setOnMenuItemClickListener { item ->
                gradeFilter = when (item.itemId) {
                    1 -> 13
                    2 -> 16
                    3 -> 20
                    else -> 0
                }
                updateFilterButtonLabels()
                applyFilters()
                true
            }
            pm.show()
        }
        updateFilterButtonLabels()
    }

    private fun updateFilterButtonLabels() {
        findViewById<Button>(R.id.sortBtn).text = when (sortMode) {
            1 -> getString(R.string.sort_posts_short) + " ▼"
            2 -> getString(R.string.sort_name_short) + " ▼"
            else -> getString(R.string.sort_deadline_short) + " ▼"
        }
        findViewById<Button>(R.id.gradeBtn).text = when (gradeFilter) {
            13 -> "১৩ ▼"
            16 -> "১৬ ▼"
            20 -> "২০ ▼"
            else -> getString(R.string.grade_all_short) + " ▼"
        }
    }

    private fun clearFilters() {
        query = ""
        findViewById<EditText>(R.id.searchBox).setText("")
        typeKey = null
        qualKey = null
        gradeFilter = 0
        sortMode = 0
        shortlistOnly = false
        findViewById<ToggleButton>(R.id.shortlistOnly).isChecked = false
        updateFilterButtonLabels()
        selectType(null, findViewById(R.id.typeChips))
        selectQual(null, findViewById(R.id.qualChips))
        applyFilters()
    }

    private fun applyFilters() {
        val data = Store.cachedData
        var list = all.filter { c ->
            if (typeKey != null && !ReminderOptions.matchesType(c, listOf(typeKey!!))) return@filter false
            if (qualKey != null && !ReminderOptions.matchesQual(c, listOf(qualKey!!))) return@filter false
            if (gradeFilter != 0 && c.grade != gradeFilter && c.posts.none { it.grade == gradeFilter }) return@filter false
            if (shortlistOnly && !data.shortlist.contains(c.id)) return@filter false
            if (query.isNotBlank()) {
                val q = query.lowercase()
                val hay = (c.org + " " + c.orgEn + " " + c.posts.joinToString(" ") { it.title }).lowercase()
                if (!hay.contains(q)) return@filter false
            }
            true
        }
        list = when (sortMode) {
            1 -> list.sortedByDescending { it.totalPosts }
            2 -> list.sortedBy { it.org }
            else -> list.sortedBy { Util.parseDeadlineMs(it.deadline) ?: Long.MAX_VALUE }
        }
        adapter.setItems(list)
        emptyView.visibility = if (list.isEmpty() && all.isNotEmpty()) View.VISIBLE else View.GONE
        updateHero()
    }

    // ---------- actions ----------

    /**
     * Launch a screen without ever killing the app: if the launch
     * itself throws (missing activity, bad intent, ...), show a
     * message and stay on home instead of "বের করে দেয়".
     */
    private fun safeStart(intent: Intent): Boolean {
        return try {
            startActivity(intent)
            true
        } catch (t: Throwable) {
            Ui.toast(this, "খোলা যায়নি — আবার চেষ্টা করুন।")
            false
        }
    }

    private fun requireLogin(): Boolean {
        if (Store.isLoggedIn) return true
        Ui.toast(this, "আগে লগইন করুন।")
        safeStart(Intent(this, LoginActivity::class.java))
        return false
    }

    private fun onApply(c: Circular) {
        if (!requireLogin()) return
        if (c.applyUrl.isBlank()) {
            Ui.toast(this, "এই সার্কুলারের আবেদন লিংক দেওয়া নেই।")
            return
        }
        Ui.openUrl(this, c.applyUrl)
    }

    private fun onShortlist(c: Circular) {
        if (!requireLogin()) return
        // Load the fresh server copy first: saving the stale local cache
        // whole would overwrite a newer profile saved from the website.
        // The toast reads the cache in the callback — updateUserData is
        // async (it refreshes first), so reading it here would be stale.
        Api.updateUserData({ data ->
            if (data.shortlist.contains(c.id)) data.shortlist.remove(c.id)
            else data.shortlist.add(c.id)
        }) {
            val saved = Store.cachedData.shortlist.contains(c.id)
            adapter.notifyDataSetChanged()
            Ui.toast(this, if (saved) "সংরক্ষণ করা হয়েছে।" else "সংরক্ষণ তুলে নেওয়া হয়েছে।")
        }
    }

    private fun openDetail(c: Circular) {
        if (!requireLogin()) return
        val i = Intent(this, DetailActivity::class.java)
        i.putExtra("circular_json", c.toJson().toString())
        safeStart(i)
    }
}
