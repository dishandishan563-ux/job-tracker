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
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.ToggleButton
import android.widget.Toolbar
import org.json.JSONObject

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
        Api.fetchConfig { json ->
            contact = json?.optJSONObject("contact")
            invalidateOptionsMenu()
        }
        tickHandler.post(tickRunnable)
        updateHandler.post(updateRunnable)
    }

    override fun onResume() {
        super.onResume()
        // Profile/shortlist may have changed on another screen — re-render.
        // Also re-apply the text-size setting (it may have changed in Settings).
        Ui.applyTextScale(findViewById(android.R.id.content))
        adapter.notifyDataSetChanged()
        updateHero()
        invalidateOptionsMenu()
        checkUpdate()
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
            if (Store.isLoggedIn) startActivity(Intent(this, ProfileActivity::class.java))
            else startActivity(Intent(this, LoginActivity::class.java))
        }
        item(getString(R.string.menu_settings)) {
            startActivity(Intent(this, SettingsActivity::class.java))
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
                startActivity(Intent(this, LoginActivity::class.java))
            }
        }
        divider()
        item(getString(R.string.menu_about)) {
            AlertDialog.Builder(this)
                .setTitle("Job Tracker")
                .setMessage("সংস্করণ v${Api.APP_VERSION_NAME}")
                .setPositiveButton("ঠিক আছে", null)
                .show()
        }
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

    private fun requireLogin(): Boolean {
        if (Store.isLoggedIn) return true
        Ui.toast(this, "আগে লগইন করুন।")
        startActivity(Intent(this, LoginActivity::class.java))
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
        val data = Store.cachedData
        if (data.shortlist.contains(c.id)) data.shortlist.remove(c.id)
        else data.shortlist.add(c.id)
        Store.cachedData = data
        Api.saveUserData(data)
        adapter.notifyDataSetChanged()
        Ui.toast(this, if (data.shortlist.contains(c.id)) "সংরক্ষণ করা হয়েছে।" else "সংরক্ষণ তুলে নেওয়া হয়েছে।")
    }

    private fun openDetail(c: Circular) {
        if (!requireLogin()) return
        val i = Intent(this, DetailActivity::class.java)
        i.putExtra("circular_json", c.toJson().toString())
        startActivity(i)
    }
}
