package com.jobtrackerbd.app

import android.content.Context
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import java.io.ByteArrayOutputStream
import java.util.zip.Inflater

/**
 * CV text extraction + field parsing — a Kotlin port of the website's
 * cv-parse.js, so a PDF/text CV picked in the app fills the profile the
 * exact same way the website upload does. Field names match the website
 * profile (name, phone, email, dob, district, edu, typeBn, typeEn,
 * address, permAddress, fatherName, motherName, skills, experience,
 * languages). Image CVs cannot be read on-device (no OCR in the app),
 * same honest limit as the website's fallback.
 */
object CvParse {

    private const val BN_D = "০১২৩৪৫৬৭৮৯"

    fun bnToEn(s: String?): String =
        (s ?: "").map { c ->
            val i = BN_D.indexOf(c)
            if (i >= 0) ('0' + i) else c
        }.joinToString("")

    // বাংলাদেশের ৬৪ জেলা।
    val DISTRICTS = listOf(
        "ঢাকা", "গাজীপুর", "কিশোরগঞ্জ", "মানিকগঞ্জ", "মুন্সিগঞ্জ", "নারায়ণগঞ্জ",
        "নরসিংদী", "টাঙ্গাইল", "ফরিদপুর", "গোপালগঞ্জ", "মাদারীপুর", "রাজবাড়ী",
        "শরীয়তপুর", "চট্টগ্রাম", "কক্সবাজার", "বান্দরবান", "রাঙামাটি", "খাগড়াছড়ি",
        "কুমিল্লা", "চাঁদপুর", "লক্ষ্মীপুর", "নোয়াখালী", "ফেনী", "ব্রাহ্মণবাড়িয়া",
        "খুলনা", "যশোর", "সাতক্ষীরা", "মেহেরপুর", "নড়াইল", "চুয়াডাঙ্গা", "কুষ্টিয়া",
        "মাগুরা", "বাগেরহাট", "ঝিনাইদহ", "রাজশাহী", "নওগাঁ", "নাটোর",
        "চাঁপাইনবাবগঞ্জ", "পাবনা", "সিরাজগঞ্জ", "বগুড়া", "জয়পুরহাট", "বরিশাল",
        "ভোলা", "পটুয়াখালী", "বরগুনা", "ঝালকাঠি", "পিরোজপুর", "সিলেট",
        "হবিগঞ্জ", "মৌলভীবাজার", "সুনামগঞ্জ", "রংপুর", "দিনাজপুর", "গাইবান্ধা",
        "কুড়িগ্রাম", "লালমনিরহাট", "নীলফামারী", "পঞ্চগড়", "ঠাকুরগাঁও",
        "ময়মনসিংহ", "জামালপুর", "শেরপুর", "নেত্রকোণা"
    )

    // জেলার ইংরেজি নাম → বাংলা (ইংরেজি CV-তে "Dhaka" লেখা থাকে)।
    val DISTRICTS_EN = mapOf(
        "dhaka" to "ঢাকা", "gazipur" to "গাজীপুর", "kishoreganj" to "কিশোরগঞ্জ",
        "manikganj" to "মানিকগঞ্জ", "munshiganj" to "মুন্সিগঞ্জ",
        "narayanganj" to "নারায়ণগঞ্জ", "narsingdi" to "নরসিংদী", "tangail" to "টাঙ্গাইল",
        "faridpur" to "ফরিদপুর", "gopalganj" to "গোপালগঞ্জ", "madaripur" to "মাদারীপুর",
        "rajbari" to "রাজবাড়ী", "shariatpur" to "শরীয়তপুর", "chattogram" to "চট্টগ্রাম",
        "chittagong" to "চট্টগ্রাম", "cox's bazar" to "কক্সবাজার", "bandarban" to "বান্দরবান",
        "rangamati" to "রাঙামাটি", "khagrachari" to "খাগড়াছড়ি", "cumilla" to "কুমিল্লা",
        "comilla" to "কুমিল্লা", "chandpur" to "চাঁদপুর", "lakshmipur" to "লক্ষ্মীপুর",
        "noakhali" to "নোয়াখালী", "feni" to "ফেনী", "brahmanbaria" to "ব্রাহ্মণবাড়িয়া",
        "khulna" to "খুলনা", "jessore" to "যশোর", "satkhira" to "সাতক্ষীরা",
        "meherpur" to "মেহেরপুর", "narail" to "নড়াইল", "chuadanga" to "চুয়াডাঙ্গা",
        "kushtia" to "কুষ্টিয়া", "magura" to "মাগুরা", "bagerhat" to "বাগেরহাট",
        "jhenaidah" to "ঝিনাইদহ", "rajshahi" to "রাজশাহী", "naogaon" to "নওগাঁ",
        "natore" to "নাটোর", "chapainawabganj" to "চাঁপাইনবাবগঞ্জ", "pabna" to "পাবনা",
        "sirajganj" to "সিরাজগঞ্জ", "bogura" to "বগুড়া", "bogra" to "বগুড়া",
        "joypurhat" to "জয়পুরহাট", "barishal" to "বরিশাল", "barisal" to "বরিশাল",
        "bhola" to "ভোলা", "patuakhali" to "পটুয়াখালী", "barguna" to "বরগুনা",
        "jhalokati" to "ঝালকাঠি", "pirojpur" to "পিরোজপুর", "sylhet" to "সিলেট",
        "habiganj" to "হবিগঞ্জ", "moulvibazar" to "মৌলভীবাজার", "sunamganj" to "সুনামগঞ্জ",
        "rangpur" to "রংপুর", "dinajpur" to "দিনাজপুর", "gaibandha" to "গাইবান্ধা",
        "kurigram" to "কুড়িগ্রাম", "lalmonirhat" to "লালমনিরহাট",
        "nilphamari" to "নীলফামারী", "panchagarh" to "পঞ্চগড়",
        "thakurgaon" to "ঠাকুরগাঁও", "mymensingh" to "ময়মনসিংহ",
        "jamalpur" to "জামালপুর", "sherpur" to "শেরপুর", "netrokona" to "নেত্রকোণা"
    )

    fun findDistrict(text: String?): String? {
        if (text.isNullOrEmpty()) return null
        for (d in DISTRICTS) if (text.contains(d)) return d
        val low = " " + text.lowercase().replace(Regex("[^a-z' ]"), " ") + " "
        for ((en, bn) in DISTRICTS_EN) {
            if (low.contains(" $en ")) return bn
        }
        return null
    }

    val CV_FIELDS = listOf(
        "name", "phone", "email", "dob", "district", "edu", "typeBn", "typeEn",
        "address", "permAddress", "fatherName", "motherName", "skills",
        "experience", "languages"
    )

    val FIELD_LABELS = mapOf(
        "name" to "নাম", "phone" to "মোবাইল", "email" to "ইমেইল",
        "dob" to "জন্ম তারিখ", "district" to "জেলা", "edu" to "শিক্ষা",
        "typeBn" to "টাইপিং (বাংলা)", "typeEn" to "টাইপিং (ইংরেজি)",
        "address" to "বর্তমান ঠিকানা", "permAddress" to "স্থায়ী ঠিকানা",
        "fatherName" to "পিতার নাম", "motherName" to "মাতার নাম",
        "skills" to "দক্ষতা", "experience" to "কর্ম অভিজ্ঞতা", "languages" to "ভাষা"
    )

    private val MONTHS = mapOf(
        "january" to 1, "jan" to 1, "february" to 2, "feb" to 2, "march" to 3,
        "mar" to 3, "april" to 4, "apr" to 4, "may" to 5, "june" to 6, "jun" to 6,
        "july" to 7, "jul" to 7, "august" to 8, "aug" to 8, "september" to 9,
        "sep" to 9, "sept" to 9, "october" to 10, "oct" to 10, "november" to 11,
        "nov" to 11, "december" to 12, "dec" to 12
    )

    fun cleanLines(text: String): List<String> =
        // Word থেকে আসা PDF-এ কার্লি অ্যাপোস্ট্রফি (’) থাকে — "Father’s Name"
        // মিলত না, তাই সোজা ' বানিয়ে নিই; বাংলা সংখ্যাও ইংরেজি করি।
        bnToEn(text.replace(Regex("[’‘]"), "'").replace(Regex("[“”]"), "\""))
            .replace("\r", "").split("\n")
            .map { it.replace(Regex("[ \t]+"), " ").trim() }
            .filter { it.isNotEmpty() }

    /** লেবেলের পরের লেখা (যেমন "Name: Ashish" → "Ashish")। Returns value + line index. */
    fun afterLabel(lines: List<String>, labels: List<String>): Pair<String, Int>? {
        for (i in lines.indices) {
            val t = lines[i].trim()
            val low = t.lowercase()
            for (lab in labels) {
                if (low.startsWith(lab.lowercase())) {
                    val v = t.substring(lab.length).replace(Regex("^[:\\-–—\\s]+"), "").trim()
                    return v to i
                }
            }
        }
        return null
    }

    private fun isHeader(line: String): Boolean =
        Regex(
            "^(education|academic|experience|work experience|skills|technical skills|" +
                "computer skills|languages|language|address|contact|objective|career objective|" +
                "personal|personal information|training|reference|references|profile|summary|" +
                "শিক্ষা|শিক্ষাগত|অভিজ্ঞতা|কর্ম অভিজ্ঞতা|দক্ষতা|ভাষা|ঠিকানা|যোগাযোগ|" +
                "ব্যক্তিগত|প্রশিক্ষণ|রেফারেন্স|উদ্দেশ্য)",
            RegexOption.IGNORE_CASE
        ).containsMatchIn(line.trim())

    private fun sectionLines(lines: List<String>, startIdx: Int, max: Int): List<String> {
        val out = mutableListOf<String>()
        var i = startIdx + 1
        while (i < lines.size && out.size < max) {
            if (isHeader(lines[i])) break
            out.add(lines[i])
            i++
        }
        return out
    }

    private fun validDate(y: String, m: String, d: String): String? {
        val yy = y.toIntOrNull() ?: return null
        val mm = m.toIntOrNull() ?: return null
        val dd = d.toIntOrNull() ?: return null
        if (!(yy in 1950..2010 && mm in 1..12 && dd in 1..31)) return null
        return "$yy-${mm.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}"
    }

    fun parseDateStr(s: String?): String? {
        val t = (s ?: "").trim()
        var m = Regex("""(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})""").find(t)
        if (m != null) return validDate(m.groupValues[1], m.groupValues[2], m.groupValues[3])
        m = Regex("""(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})""").find(t)
        if (m != null) {
            var d = m.groupValues[1].toInt()
            var mo = m.groupValues[2].toInt()
            // DD-MM-YYYY (15-01-2000) is already day-first: swap only when
            // the first number fits a month and the second does not
            // (MM-DD-YYYY). NOTE: the website's cv-parse.js has this
            // condition backwards (it swaps when d > 12) and loses DOBs
            // like 15-01-2000 — flagged for the website fix; the app
            // parses them correctly.
            if (d <= 12 && mo > 12) {
                val tmp = d; d = mo; mo = tmp
            }
            return validDate(m.groupValues[3], mo.toString(), d.toString())
        }
        m = Regex("""(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})""").find(t)
        if (m != null && MONTHS.containsKey(m.groupValues[2].lowercase())) {
            return validDate(m.groupValues[3], MONTHS[m.groupValues[2].lowercase()].toString(), m.groupValues[1])
        }
        m = Regex("""([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})""").find(t)
        if (m != null && MONTHS.containsKey(m.groupValues[1].lowercase())) {
            return validDate(m.groupValues[3], MONTHS[m.groupValues[1].lowercase()].toString(), m.groupValues[2])
        }
        return null
    }

    fun parseCvText(text: String): Map<String, Any> {
        val lines = cleanLines(text)
        val out = mutableMapOf<String, Any>()
        val full = lines.joinToString("\n")

        // ---- নাম ----
        val nameLab = afterLabel(lines, listOf("full name", "name", "নাম"))
        if (nameLab != null && nameLab.first.matches(Regex("^[A-Za-z\\u0980-\\u09FF .'-]{2,50}$")) &&
            !nameLab.first.any { it.isDigit() }
        ) {
            out["name"] = nameLab.first.split(",", "|")[0].trim()
        } else {
            for (l in lines) {
                if (Regex(
                        "^(curriculum vitae|cv|resume|résumé|বায়োডাটা|জীবনবৃত্তান্ত|" +
                            "bio-?data|personal information|ব্যক্তিগত তথ্য)",
                        RegexOption.IGNORE_CASE
                    ).containsMatchIn(l)
                ) continue
                if (l.endsWith(":")) continue
                val words = l.split(Regex("\\s+"))
                if (words.size in 2..4 && !l.any { it.isDigit() } && !l.contains("@") &&
                    l.length <= 45 &&
                    words.all { Regex("^[A-Za-z\\u0980-\\u09FF.'-]+$").matches(it) }
                ) {
                    out["name"] = l
                    break
                }
            }
        }

        // ---- মোবাইল ----
        // নম্বরে মাঝখানে - বা স্পেস থাকে (01712-345678) — সেগুলো সহ মিলিয়ে
        // শুধু সংখ্যাগুলো নিই; শেষে ০১ দিয়ে শুরু ১১ সংখ্যার নম্বর হতে হবে।
        val ph = Regex("""(?:\+?880[\s\-]?|0)1[3-9][\d\s\-]{7,12}""").find(full)
        if (ph != null) {
            var d = ph.value.replace(Regex("\\D"), "")
            if (d.startsWith("880")) d = "0" + d.substring(3)
            if (Regex("""^01[3-9]\d{8}$""").matches(d)) out["phone"] = d
        }

        // ---- ইমেইল ----
        // TLD-র পর আর অক্ষর থাকলে সেটা জোড়া লেখা (লাইন ভাঙা পড়েনি) —
        // তখন মিলবে না, ভুল ইমেইল বসবে না।
        val em = Regex("""[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z])""").find(full)
        if (em != null) out["email"] = em.value

        // ---- জন্ম তারিখ ----
        var dob: String? = null
        val dobLab = afterLabel(
            lines,
            listOf("date of birth", "dob", "জন্ম তারিখ", "জন্মতারিখ", "birth date")
        )
        if (dobLab != null) {
            dob = parseDateStr(dobLab.first)
                ?: (if (dobLab.second + 1 < lines.size) parseDateStr(lines[dobLab.second + 1]) else null)
        }
        if (dob == null) {
            val dm = Regex("""(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})""").find(full)
            if (dm != null) dob = parseDateStr(dm.value)
        }
        if (dob == null) {
            val dm2 = Regex(
                """(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{4})""",
                RegexOption.IGNORE_CASE
            ).find(full)
            if (dm2 != null) dob = parseDateStr(dm2.value)
        }
        if (dob != null) out["dob"] = dob

        // ---- জেলা ----
        val distLab = afterLabel(lines, listOf("district", "জেলা"))
        var district: String? = null
        if (distLab != null && distLab.first.isNotEmpty()) district = findDistrict(distLab.first)
        if (district == null) district = findDistrict(full)
        if (district != null) out["district"] = district

        // ---- শিক্ষা (প্রোফাইলের অপশনের মানেই) ----
        if (Regex("স্নাতক|bachelor|honou?rs|\\bb\\.?\\s?a\\b|\\bb\\.?\\s?sc\\b|\\bbba\\b|graduate", RegexOption.IGNORE_CASE).containsMatchIn(full)) out["edu"] = "স্নাতক"
        else if (Regex("এইচএসসি|\\bhsc\\b|higher secondary", RegexOption.IGNORE_CASE).containsMatchIn(full)) out["edu"] = "HSC"
        else if (Regex("এসএসসি|\\bssc\\b|secondary school", RegexOption.IGNORE_CASE).containsMatchIn(full)) out["edu"] = "SSC"
        else if (Regex("\\bjsc\\b").containsMatchIn(full)) out["edu"] = "JSC"

        // ---- টাইপিং (শব্দ/মিনিট) ----
        // \b লাগে: "Bangladesh"-এর ভেতরের "Bangla" ধরে পরের ১৫ (জন্ম তারিখ)
        // টাইপিং ভেবে বসত — শব্দের সীমানা থাকলে সেটা হয় না।
        val tb = Regex("""\b(বাংলা|bangla)\b[^0-9\n]{0,25}(\d{1,3})""", RegexOption.IGNORE_CASE).find(full)
        if (tb != null) {
            val v = tb.groupValues[2].toInt()
            if (v in 5..80) out["typeBn"] = v
        }
        val te = Regex("""\b(ইংরেজি|english)\b[^0-9\n]{0,25}(\d{1,3})""", RegexOption.IGNORE_CASE).find(full)
        if (te != null) {
            val v = te.groupValues[2].toInt()
            if (v in 5..80) out["typeEn"] = v
        }

        // ---- ঠিকানা ----
        val presLab = afterLabel(lines, listOf("present address", "বর্তমান ঠিকানা", "current address"))
        if (presLab != null) {
            var v = presLab.first
            if (v.length < 12) {
                val extra = sectionLines(lines, presLab.second, 2)
                if (extra.isNotEmpty()) v = (v + " " + extra.joinToString(" ")).trim()
            }
            if (v.isNotEmpty()) out["address"] = v
        }
        val permLab = afterLabel(lines, listOf("permanent address", "স্থায়ী ঠিকানা"))
        if (permLab != null) {
            var v = permLab.first
            if (v.length < 12) {
                val extra = sectionLines(lines, permLab.second, 2)
                if (extra.isNotEmpty()) v = (v + " " + extra.joinToString(" ")).trim()
            }
            if (v.isNotEmpty()) out["permAddress"] = v
        }
        if (!out.containsKey("address")) {
            val aLab = afterLabel(lines, listOf("address", "ঠিকানা"))
            if (aLab != null && aLab.first.isNotEmpty()) out["address"] = aLab.first
        }

        // ---- পিতা / মাতা ----
        val fa = afterLabel(lines, listOf("father's name", "father name", "পিতার নাম"))
        if (fa != null && fa.first.isNotEmpty()) out["fatherName"] = fa.first.split(",", "|")[0].trim()
        val mo = afterLabel(lines, listOf("mother's name", "mother name", "মাতার নাম"))
        if (mo != null && mo.first.isNotEmpty()) out["motherName"] = mo.first.split(",", "|")[0].trim()

        // ---- দক্ষতা ----
        val skIdx = lines.indexOfFirst {
            Regex("^(skills|technical skills|computer skills|দক্ষতা)", RegexOption.IGNORE_CASE).containsMatchIn(it.trim())
        }
        if (skIdx >= 0) {
            val v = if (lines[skIdx].contains(":")) lines[skIdx].split(":").drop(1).joinToString(":").trim() else ""
            val rest = sectionLines(lines, skIdx, 5)
            var joined = (listOf(v) + rest).filter { it.isNotEmpty() }.joinToString(", ")
            if (joined.isEmpty()) {
                // "Skills" শিরোনামের পরেই "Computer Skills: ..." লাইন থাকলে
                // sectionLines সেটাকে শিরোনাম ভেবে থেমে যায় — সেই লাইনের
                // মানটাই দক্ষতা (Word-এর CV-তে খুব সাধারণ লেআউট)।
                val nx = lines.getOrNull(skIdx + 1)
                if (nx != null && Regex("^(technical skills|computer skills)", RegexOption.IGNORE_CASE).containsMatchIn(nx.trim()) && nx.contains(":")) {
                    joined = nx.substringAfter(":").trim()
                }
            }
            if (joined.isNotEmpty()) out["skills"] = joined
        }

        // ---- কর্ম অভিজ্ঞতা ----
        val exIdx = lines.indexOfFirst {
            Regex("^(experience|work experience|employment|অভিজ্ঞতা|কর্ম অভিজ্ঞতা)", RegexOption.IGNORE_CASE).containsMatchIn(it.trim())
        }
        if (exIdx >= 0) {
            val v = if (lines[exIdx].contains(":")) lines[exIdx].split(":").drop(1).joinToString(":").trim() else ""
            val rest = sectionLines(lines, exIdx, 6)
            val joined = (listOf(v) + rest).filter { it.isNotEmpty() }.joinToString("\n")
            if (joined.isNotEmpty()) out["experience"] = joined
        }

        // ---- ভাষা ----
        val lg = afterLabel(lines, listOf("languages", "language", "ভাষা"))
        if (lg != null) {
            var v = lg.first
            if (v.isEmpty() && lg.second + 1 < lines.size) {
                // "Languages" শিরোনামের পরের লাইনে মান থাকে
                // ("Languages: Bangla, English") — সেটাই নিই।
                val nx = lines[lg.second + 1]
                v = if (nx.contains(":")) nx.substringAfter(":").trim() else nx
            }
            if (v.isNotEmpty()) out["languages"] = v
        }

        return out
    }

    // ---- Profile field access by name (same names as the website) ----

    fun fieldValue(p: Profile, k: String): Any? = when (k) {
        "name" -> p.name
        "phone" -> p.phone
        "email" -> p.email
        "dob" -> p.dob
        "district" -> p.district
        "edu" -> p.edu
        "typeBn" -> p.typeBn
        "typeEn" -> p.typeEn
        "address" -> p.address
        "permAddress" -> p.permAddress
        "fatherName" -> p.fatherName
        "motherName" -> p.motherName
        "skills" -> p.skills
        "experience" -> p.experience
        "languages" -> p.languages
        else -> null
    }

    private fun setField(p: Profile, k: String, v: Any) {
        when (k) {
            "name" -> p.name = v.toString()
            "phone" -> p.phone = v.toString()
            "email" -> p.email = v.toString()
            "dob" -> p.dob = v.toString()
            "district" -> p.district = v.toString()
            "edu" -> p.edu = v.toString()
            "typeBn" -> p.typeBn = (v as? Number)?.toInt() ?: v.toString().toIntOrNull() ?: 20
            "typeEn" -> p.typeEn = (v as? Number)?.toInt() ?: v.toString().toIntOrNull() ?: 20
            "address" -> p.address = v.toString()
            "permAddress" -> p.permAddress = v.toString()
            "fatherName" -> p.fatherName = v.toString()
            "motherName" -> p.motherName = v.toString()
            "skills" -> p.skills = v.toString()
            "experience" -> p.experience = v.toString()
            "languages" -> p.languages = v.toString()
        }
    }

    private val CV_DEFAULTS = mapOf<String, Any>("typeBn" to 20, "typeEn" to 20, "edu" to "HSC")

    /** CV আপলোডে CV-ই শেষ কথা: CV-তে যা আছে, প্রোফাইলের সব ঘরে তা-ই বসবে —
        আগে কোনো মান থাকলেও CV-র মান জিতবে (ASHISH-এর নির্দেশ: A-Z সব বসবে)।
        ওয়েবসাইটের applyCvFieldsToProfile এখন এটাই ব্যবহার করে। */
    fun overwriteCvFields(profile: Profile, fields: Map<String, Any>): Pair<Profile, List<String>> {
        val next = profile.copy()
        val filled = mutableListOf<String>()
        for (k in CV_FIELDS) {
            val v = fields[k] ?: continue
            if (v is String && v.isEmpty()) continue
            setField(next, k, v)
            filled.add(k)
        }
        return next to filled
    }

    /** Same rule as the website's mergeCvFields: empty fields fill; a field
        that still holds the previous CV's value is replaced; a hand-edited
        field is never touched. (Kept for parity; the upload flow now uses
        overwriteCvFields.) */
    fun mergeCvFields(profile: Profile, fields: Map<String, Any>, oldSnap: Map<String, String>?): Pair<Profile, List<String>> {
        val next = profile.copy()
        val filled = mutableListOf<String>()
        for (k in CV_FIELDS) {
            val v = fields[k] ?: continue
            if (v is String && v.isEmpty()) continue
            val cur = fieldValue(next, k)
            if (cur == null || (cur is String && cur.isEmpty()) ||
                cur.toString() == oldSnap?.get(k) ||
                (CV_DEFAULTS.containsKey(k) && cur.toString() == CV_DEFAULTS[k].toString())
            ) {
                setField(next, k, v)
                filled.add(k)
            }
        }
        return next to filled
    }

    /** Same rule as the website's removeCvFields: only fields that still
        match the CV snapshot are cleared (hand-edited fields stay);
        typing returns to the 20 default. */
    fun removeCvFields(profile: Profile, snap: Map<String, String>): Profile {
        val next = profile.copy()
        for ((k, v) in snap) {
            val cur = fieldValue(next, k)
            if (cur != null && cur.toString() == v) {
                if (k == "typeBn" || k == "typeEn") setField(next, k, 20) else setField(next, k, "")
            }
        }
        next.cv = null
        return next
    }

    // ---- File → text ----

    private fun inflateBytes(input: ByteArray, nowrap: Boolean): ByteArray? {
        return try {
            val inf = Inflater(nowrap)
            inf.setInput(input)
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            while (!inf.finished()) {
                val n = inf.inflate(buf)
                if (n == 0) break
                out.write(buf, 0, n)
            }
            inf.end()
            out.toByteArray()
        } catch (e: Exception) {
            null
        }
    }

    private fun unescapePdfString(s: String): String {
        val end = s.lastIndexOf(')')
        val inner = (if (end >= 0) s.substring(0, end) else s).removePrefix("(")
        return inner.replace(Regex("""\\([()\\])"""), "$1")
            .replace("\\n", " ").replace("\\r", " ").replace("\\t", " ")
    }

    /** PDF-র raw stream থেকে লেখা তোলা (cv-parse.js extractPdfTextRaw-এর
        পোর্ট): FlateDecode stream খোলে, ( ... ) Tj ও [ ... ] TJ থেকে স্ট্রিং তোলে। */
    fun extractPdfText(bytes: ByteArray): String {
        val raw = StringBuilder()
        for (b in bytes) raw.append((b.toInt() and 0xff).toChar())
        val rawStr = raw.toString()
        val parts = mutableListOf<String>()
        val streamRe = Regex("stream\\r?\\n([\\s\\S]*?)\\r?\\nendstream")
        for (m in streamRe.findAll(rawStr)) {
            val body = m.groupValues[1]
            val sb = ByteArray(body.length) { i -> (body[i].code and 0xff).toByte() }
            var text: String? = null
            val inflated = inflateBytes(sb, false) ?: inflateBytes(sb, true)
            if (inflated != null) {
                val t = StringBuilder()
                for (b in inflated) t.append((b.toInt() and 0xff).toChar())
                text = t.toString()
            }
            if (text == null) text = body
            val segs = mutableListOf<String>()
            val tjRe = Regex("""\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[^\]])*\]\s*TJ""")
            var prevEnd = 0
            for (hit in tjRe.findAll(text)) {
                val gap = text.substring(prevEnd, hit.range.first)
                // Tj/TJ রানগুলো ক্রমে নাও; মাঝে Td/T*/TD/Tm (নতুন লাইন/অবস্থান)
                // থাকলে লাইন ভাঙো — নইলে সব লাইন জোড়া লেগে একটাই লাইন হয়ে যায়
                // (Word থেকে আসা PDF-এ লাইন সাজাতে Tm-ই বেশি ব্যবহৃত হয়)।
                if (segs.isNotEmpty() && Regex("""(^|\s)(Td|TD|T\*|Tm)""").containsMatchIn(gap)) segs.add("\n")
                val s = hit.value
                if (s.trimEnd().endsWith("Tj")) {
                    segs.add(unescapePdfString(s))
                } else {
                    val inner = Regex("""\((?:\\.|[^\\()])*\)""").findAll(s)
                        .map { unescapePdfString(it.value) }.joinToString("")
                    segs.add(inner)
                }
                prevEnd = hit.range.last + 1
            }
            parts.add(segs.joinToString(""))
        }
        return parts.joinToString("\n").split("\n")
            .map { it.replace(Regex("[ \t]+"), " ").trim() }
            .filter { it.isNotEmpty() }.joinToString("\n")
    }

    /** PDF পড়ার ফল — স্ক্যান করা (ছবি) PDF-এ লেখার লেয়ারই থাকে না,
        সেটা আলাদা করে জানা দরকার যাতে UI সঠিক বার্তা দেখাতে পারে। */
    enum class PdfStatus { OK, NO_TEXT_LAYER, FAILED }

    /** PDF bytes → (text, status). Primary: PdfBox-Android — filter chain
        (ASCII85+Flate), hex-string text, ToUnicode CMap, xref/object
        stream — হাতে লেখা raw extractor যা পারে না, সব পারে। PdfBox না
        পারলে raw extractor fallback; সেটাও না পারলে FAILED। লেখার
        লেয়ারই নেই (স্ক্যান করা ছবির PDF) — NO_TEXT_LAYER। */
    fun extractPdf(bytes: ByteArray, context: Context?): Pair<String?, PdfStatus> {
        try {
            if (context != null) {
                try {
                    if (!PDFBoxResourceLoader.isReady()) PDFBoxResourceLoader.init(context)
                } catch (_: Exception) {
                    // init না হলেও PdfBox classpath resource দিয়ে চেষ্টা করবে
                }
            }
            PDDocument.load(bytes).use { doc ->
                val stripper = PDFTextStripper()
                stripper.sortByPosition = true
                val text = stripper.getText(doc)
                if (text.isBlank()) {
                    return if (doc.numberOfPages > 0) null to PdfStatus.NO_TEXT_LAYER
                    else null to PdfStatus.FAILED
                }
                return text to PdfStatus.OK
            }
        } catch (_: Exception) {
            // নিচে raw fallback
        }
        val raw = extractPdfText(bytes)
        return if (raw.isNotBlank()) raw to PdfStatus.OK else null to PdfStatus.FAILED
    }

    /** Picked file bytes → readable text, or null when the file cannot be
        read on-device (image CVs need OCR, which the app does not ship —
        use a PDF or text CV instead). */
    fun extractText(bytes: ByteArray, mime: String?, fileName: String?): String? {
        val m = (mime ?: "").lowercase()
        return when {
            m.startsWith("text/") -> bytes.toString(Charsets.UTF_8)
            m == "application/pdf" || fileName?.lowercase()?.endsWith(".pdf") == true ->
                extractPdfText(bytes)
            m.startsWith("image/") -> null
            else -> bytes.toString(Charsets.UTF_8)
        }
    }
}
