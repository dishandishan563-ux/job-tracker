package com.jobtrackerbd.app

import java.security.MessageDigest
import java.util.Calendar
import java.util.TimeZone

/** Bengali digits + date/countdown helpers (Dhaka time). */
object Util {
    private val BN = arrayOf('০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯')

    fun bn(value: Any?): String {
        val s = value?.toString() ?: return ""
        val out = StringBuilder()
        for (ch in s) {
            out.append(if (ch in '0'..'9') BN[ch - '0'] else ch)
        }
        return out.toString()
    }

    fun sha256Hex(s: String): String {
        val d = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
        return d.joinToString("") { "%02x".format(it) }
    }

    /** "1.1.0" vs "1.0.0" -> positive when a is newer. */
    fun cmpVersion(a: String, b: String): Int {
        val pa = a.split(".").map { it.toIntOrNull() ?: 0 }
        val pb = b.split(".").map { it.toIntOrNull() ?: 0 }
        val n = maxOf(pa.size, pb.size)
        for (i in 0 until n) {
            val d = (pa.getOrNull(i) ?: 0) - (pb.getOrNull(i) ?: 0)
            if (d != 0) return d
        }
        return 0
    }

    // ISO-8601 deadline parser. Must accept every format the server
    // actually sends: seeded circulars use "2026-11-25T16:00:00+06:00",
    // but auto-added (Teletalk discovery) circulars use
    // "2026-11-25T10:00:00.000Z" (millis + Z) and addedAt is the same
    // shape. The old regex required seconds + a ±HH offset, so it
    // returned null for ALL auto-added circulars: their deadline line
    // showed raw ISO text, the countdown was blank, deadline-sort
    // pushed them to the bottom, and the 🆕 badge never showed.
    private val DL_RE =
        Regex("""(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?""")

    /** Parse an ISO-8601 deadline like "2026-11-07T16:00:00+06:00" or
        "2026-11-25T10:00:00.000Z" to epoch ms. No zone = Dhaka-local;
        date-only = end of that day (23:59:59). */
    fun parseDeadlineMs(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        val m = DL_RE.find(iso.trim()) ?: return null
        val (y, mo, d, h, mi, s, zone) = m.destructured
        val tzId = when {
            zone == "Z" -> "GMT+00:00"
            zone.startsWith("+") || zone.startsWith("-") -> {
                val z = zone.replace(":", "")
                "GMT${z.substring(0, 3)}:${z.substring(3, 5)}"
            }
            else -> "GMT+06:00" // no zone: server deadlines are Dhaka-local
        }
        val tz = TimeZone.getTimeZone(tzId)
        val cal = Calendar.getInstance(tz)
        cal.set(
            y.toInt(), mo.toInt() - 1, d.toInt(),
            // No time at all = end of that day; time without seconds = :00.
            h.toIntOrNull() ?: 23, mi.toIntOrNull() ?: 59,
            s.toIntOrNull() ?: if (h.isEmpty()) 59 else 0
        )
        cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }

    private val MONTHS_BN = arrayOf(
        "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
        "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"
    )

    /** "৭ নভেম্বর, ২০২৬, বিকেল ৪টা" — Dhaka time, Bengali digits. */
    fun formatDeadlineBn(iso: String?): String {
        val ms = parseDeadlineMs(iso) ?: return iso ?: ""
        val cal = Calendar.getInstance(TimeZone.getTimeZone("Asia/Dhaka"))
        cal.timeInMillis = ms
        val day = cal.get(Calendar.DAY_OF_MONTH)
        val month = MONTHS_BN[cal.get(Calendar.MONTH)]
        val year = cal.get(Calendar.YEAR)
        val h24 = cal.get(Calendar.HOUR_OF_DAY)
        val min = cal.get(Calendar.MINUTE)
        val part = when (h24) {
            in 0..3 -> "রাত"
            in 4..5 -> "ভোর"
            in 6..11 -> "সকাল"
            12 -> "দুপুর"
            in 13..15 -> "দুপুর"
            in 16..17 -> "বিকেল"
            in 18..19 -> "সন্ধ্যা"
            else -> "রাত"
        }
        val h12 = when {
            h24 == 0 -> 12
            h24 > 12 -> h24 - 12
            else -> h24
        }
        val time = if (min == 0) "$part ${bn(h12)}টা" else "$part ${bn(h12)}:${bn(String.format("%02d", min))}"
        return "${bn(day)} $month, ${bn(year)}, $time"
    }

    /** Live countdown text for a deadline, e.g. "৩ দিন ১৩:৫৯:২৭ বাকি". */
    fun countdownText(iso: String?, nowMs: Long = System.currentTimeMillis()): String {
        val dl = parseDeadlineMs(iso) ?: return ""
        val diff = dl - nowMs
        if (diff <= 0) return "⏰ শেষ হয়ে গেছে"
        val totalSec = diff / 1000
        val days = totalSec / 86400
        val h = (totalSec % 86400) / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        val hms = "${bn(String.format("%02d", h))}:${bn(String.format("%02d", m))}:${bn(String.format("%02d", s))}"
        return if (days > 0) "⏳ ${bn(days)} দিন $hms বাকি" else "⏳ $hms বাকি"
    }

    /** "নতুন" badge — added within the last 7 days. */
    fun isNew(addedAt: String?): Boolean {
        if (addedAt.isNullOrBlank()) return false
        val t = parseDeadlineMs(addedAt) ?: return false
        return System.currentTimeMillis() - t < 7L * 86400000L
    }
}
