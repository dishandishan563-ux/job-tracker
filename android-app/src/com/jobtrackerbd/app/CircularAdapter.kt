package com.jobtrackerbd.app

import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.TextView

/** Home circular list rows. Countdowns are refreshed in place by MainActivity. */
class CircularAdapter(
    private val ctx: Context,
    private var items: List<Circular>,
    private val onApply: (Circular) -> Unit,
    private val onShortlist: (Circular) -> Unit,
    private val onOpen: (Circular) -> Unit
) : BaseAdapter() {

    fun setItems(newItems: List<Circular>) {
        items = newItems
        notifyDataSetChanged()
    }

    override fun getCount(): Int = items.size
    override fun getItem(position: Int): Circular = items[position]
    override fun getItemId(position: Int): Long = position.toLong()

    private class Holder(
        val org: TextView,
        val newBadge: TextView,
        val typeLine: TextView,
        val postsLine: TextView,
        val deadlineLine: TextView,
        val cdText: TextView,
        val matchBadge: TextView,
        val statusBadge: TextView,
        val applyBtn: Button,
        val shortlistBtn: Button,
        val sourceNote: TextView
    )

    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val view: View
        val h: Holder
        if (convertView == null) {
            view = LayoutInflater.from(ctx).inflate(R.layout.item_circular, parent, false)
            h = Holder(
                org = view.findViewById(R.id.org),
                newBadge = view.findViewById(R.id.newBadge),
                typeLine = view.findViewById(R.id.typeLine),
                postsLine = view.findViewById(R.id.postsLine),
                deadlineLine = view.findViewById(R.id.deadlineLine),
                cdText = view.findViewById(R.id.cdText),
                matchBadge = view.findViewById(R.id.matchBadge),
                statusBadge = view.findViewById(R.id.statusBadge),
                applyBtn = view.findViewById(R.id.applyBtn),
                shortlistBtn = view.findViewById(R.id.shortlistBtn),
                sourceNote = view.findViewById(R.id.sourceNote)
            )
            view.tag = h
        } else {
            view = convertView
            h = view.tag as Holder
        }
        val c = items[position]
        val data = Store.cachedData

        h.org.text = c.org
        h.newBadge.visibility = if (Util.isNew(c.addedAt)) View.VISIBLE else View.GONE
        val typeTxt = listOf(
            c.typeBn.ifBlank { c.type },
            if (c.grade > 0) "গ্রেড ${Util.bn(c.grade)}" else "",
            c.salary
        ).filter { it.isNotBlank() }.joinToString(" • ")
        h.typeLine.text = typeTxt
        val postsTxt = buildString {
            if (c.totalPosts > 0) append("মোট ${Util.bn(c.totalPosts)}টি পদ")
            if (c.hscPosts > 0) {
                if (isNotEmpty()) append(" • ")
                append("HSC ${Util.bn(c.hscPosts)}টি")
            }
            if (c.fee > 0) {
                if (isNotEmpty()) append(" • ")
                append("ফি ${Util.bn(c.fee)} টাকা")
            }
        }
        h.postsLine.text = postsTxt
        h.postsLine.visibility = if (postsTxt.isEmpty()) View.GONE else View.VISIBLE
        h.deadlineLine.text = if (c.deadline.isNotBlank()) {
            "শেষ: ${Util.formatDeadlineBn(c.deadline)}"
        } else ""
        h.deadlineLine.visibility = if (c.deadline.isBlank()) View.GONE else View.VISIBLE
        h.cdText.text = Util.countdownText(c.deadline)
        h.cdText.tag = c.deadline
        h.cdText.visibility = if (c.deadline.isBlank()) View.GONE else View.VISIBLE
        h.matchBadge.visibility =
            if (c.matchesProfile(data.profile)) View.VISIBLE else View.GONE
        val st = Ui.statusLabel(data.status[c.id])
        h.statusBadge.text = st
        h.statusBadge.visibility = if (st.isEmpty()) View.GONE else View.VISIBLE
        val saved = data.shortlist.contains(c.id)
        h.shortlistBtn.text = if (saved) ctx.getString(R.string.saved) else ctx.getString(R.string.save_shortlist)
        h.sourceNote.text = if (c.source == "secondary") {
            c.sourceNote.ifBlank { "দ্বিতীয় সূত্রের তথ্য — আবেদনের আগে অফিসিয়াল সার্কুলার যাচাই করুন।" }
        } else ""
        h.sourceNote.visibility = if (c.source == "secondary") View.VISIBLE else View.GONE

        h.applyBtn.setOnClickListener { onApply(c) }
        h.shortlistBtn.setOnClickListener { onShortlist(c) }
        view.setOnClickListener { onOpen(c) }
        Ui.applyTextScale(view)
        return view
    }
}
