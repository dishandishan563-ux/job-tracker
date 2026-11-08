package com.jobtrackerbd.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.Spinner
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
        setupSpinners()
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
            updateText.text = "🔔 নতুন আপডেট এসেছে (v$name) — আপডেট করুন"
            updateBanner.visibility = View.VISIBLE
        })
    }

    // ---------- menu ----------

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(Menu.NONE, 1, Menu.NONE, getString(R.string.menu_profile))
        menu.add(Menu.NONE, 2, Menu.NONE, getString(R.string.menu_settings))
        menu.add(Menu.NONE, 3, Menu.NONE, getString(R.string.menu_contact))
        menu.add(Menu.NONE, 4, Menu.NONE, getString(R.string.menu_refresh))
        menu.add(Menu.NONE, 5, Menu.NONE, "")
        menu.add(Menu.NONE, 6, Menu.NONE, getString(R.string.menu_about))
        return true
    }

    override fun onPrepareOptionsMenu(menu: Menu): Boolean {
        val contactItem = menu.findItem(3)
        val wa = contact?.optString("whatsapp", "") ?: ""
        val tg = contact?.optString("telegram", "") ?: ""
        contactItem.isVisible = wa.isNotBlank() || tg.isNotBlank()
        menu.findItem(5).title =
            if (Store.isLoggedIn) getString(R.string.menu_logout) else getString(R.string.menu_login)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        when (item.itemId) {
            1 -> {
                if (Store.isLoggedIn) startActivity(Intent(this, ProfileActivity::class.java))
                else startActivity(Intent(this, LoginActivity::class.java))
            }
            2 -> startActivity(Intent(this, SettingsActivity::class.java))
            3 -> showContactDialog()
            4 -> loadCirculars()
            5 -> {
                if (Store.isLoggedIn) {
                    Store.logout()
                    Ui.toast(this, "লগআউট হয়েছে।")
                    adapter.notifyDataSetChanged()
                    invalidateOptionsMenu()
                } else {
                    startActivity(Intent(this, LoginActivity::class.java))
                }
            }
            6 -> AlertDialog.Builder(this)
                .setTitle("Job Tracker")
                .setMessage("সংস্করণ v${Api.APP_VERSION_NAME}\n\nনেটিভ অ্যান্ড্রয়েড অ্যাপ — সার্কুলার, লগইন, প্রোফাইল ও রিমাইন্ডার সার্ভার থেকে চলে, ওয়েবসাইটের মতোই।")
                .setPositiveButton("ঠিক আছে", null)
                .show()
        }
        return true
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

    private fun setupSpinners() {
        val sort = findViewById<Spinner>(R.id.sortSpinner)
        sort.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_dropdown_item,
            listOf(
                getString(R.string.sort_deadline),
                getString(R.string.sort_posts),
                getString(R.string.sort_name)
            )
        )
        sort.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                sortMode = pos
                applyFilters()
            }
            override fun onNothingSelected(p: AdapterView<*>?) {}
        }
        val grade = findViewById<Spinner>(R.id.gradeSpinner)
        grade.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_dropdown_item,
            listOf("সব গ্রেড", "১৩", "১৬", "২০")
        )
        grade.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                gradeFilter = when (pos) {
                    1 -> 13
                    2 -> 16
                    3 -> 20
                    else -> 0
                }
                applyFilters()
            }
            override fun onNothingSelected(p: AdapterView<*>?) {}
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
        findViewById<Spinner>(R.id.sortSpinner).setSelection(0)
        findViewById<Spinner>(R.id.gradeSpinner).setSelection(0)
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
