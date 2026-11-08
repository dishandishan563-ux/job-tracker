package com.jobtrackerbd.app

import org.json.JSONArray
import org.json.JSONObject

data class Post(
    val count: Int = 0,
    val grade: Int = 0,
    val qualification: String = "",
    val title: String = "",
    val typingBn: Int = 0,
    val typingEn: Int = 0,
    val shorthandBn: Int = 0,
    val shorthandEn: Int = 0
)

data class Circular(
    val id: String,
    val org: String,
    val orgEn: String = "",
    val type: String = "",
    val typeBn: String = "",
    val totalPosts: Int = 0,
    val hscPosts: Int = 0,
    val grade: Int = 0,
    val salary: String = "",
    val fee: Int = 0,
    val age: String = "",
    val districts: String = "",
    val deadline: String = "",
    val applyUrl: String = "",
    val posts: List<Post> = emptyList(),
    val source: String = "",
    val sourceNote: String = "",
    val addedAt: String? = null,
    val autoAdded: Boolean = false
) {
    fun toJson(): JSONObject {
        val o = JSONObject()
        o.put("id", id)
        o.put("org", org)
        o.put("orgEn", orgEn)
        o.put("type", type)
        o.put("typeBn", typeBn)
        o.put("totalPosts", totalPosts)
        o.put("hscPosts", hscPosts)
        o.put("grade", grade)
        o.put("salary", salary)
        o.put("fee", fee)
        o.put("age", age)
        o.put("districts", districts)
        o.put("deadline", deadline)
        o.put("applyUrl", applyUrl)
        val arr = JSONArray()
        for (p in posts) {
            arr.put(JSONObject().apply {
                put("count", p.count)
                put("grade", p.grade)
                put("qualification", p.qualification)
                put("title", p.title)
                put("typingBn", p.typingBn)
                put("typingEn", p.typingEn)
                put("shorthandBn", p.shorthandBn)
                put("shorthandEn", p.shorthandEn)
            })
        }
        o.put("posts", arr)
        o.put("source", source)
        o.put("sourceNote", sourceNote)
        if (addedAt != null) o.put("addedAt", addedAt)
        o.put("autoAdded", autoAdded)
        return o
    }

    companion object {
        fun fromJson(o: JSONObject): Circular {
            val posts = mutableListOf<Post>()
            val arr = o.optJSONArray("posts")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val p = arr.optJSONObject(i) ?: continue
                    posts.add(
                        Post(
                            count = p.optInt("count", 0),
                            grade = p.optInt("grade", 0),
                            qualification = p.optString("qualification", ""),
                            title = p.optString("title", ""),
                            typingBn = p.optInt("typingBn", 0),
                            typingEn = p.optInt("typingEn", 0),
                            shorthandBn = p.optInt("shorthandBn", 0),
                            shorthandEn = p.optInt("shorthandEn", 0)
                        )
                    )
                }
            }
            return Circular(
                id = o.optString("id", ""),
                org = o.optString("org", ""),
                orgEn = o.optString("orgEn", ""),
                type = o.optString("type", ""),
                typeBn = o.optString("typeBn", ""),
                totalPosts = o.optInt("totalPosts", 0),
                hscPosts = o.optInt("hscPosts", 0),
                grade = o.optInt("grade", 0),
                salary = o.optString("salary", ""),
                fee = o.optInt("fee", 0),
                age = o.optString("age", ""),
                districts = o.optString("districts", ""),
                deadline = o.optString("deadline", ""),
                applyUrl = o.optString("applyUrl", ""),
                posts = posts,
                source = o.optString("source", ""),
                sourceNote = o.optString("sourceNote", ""),
                addedAt = if (o.has("addedAt")) o.optString("addedAt", null) else null,
                autoAdded = o.optBoolean("autoAdded", false)
            )
        }
    }

    /** CV-match badge, same rule as the website: education + typing fit. */
    fun matchesProfile(p: Profile?): Boolean {
        if (p == null) return false
        val eduOk = (p.edu.isBlank() || p.edu == "HSC") ||
            posts.any { it.qualification == p.edu }
        val typeOk = posts.any {
            it.typingBn <= p.typeBn && it.typingEn <= p.typeEn
        }
        return eduOk && typeOk
    }
}

data class Profile(
    var name: String = "",
    var address: String = "",
    var phone: String = "",
    var photo: String = "",
    var district: String = "",
    var dob: String = "",
    var edu: String = "HSC",
    var typeBn: Int = 20,
    var typeEn: Int = 20,
    var notes: String = "",
    var remindersEnabled: Boolean = true,
    var remTypes: List<String> = emptyList(),
    var remQuals: List<String> = emptyList()
) {
    fun toJson(): JSONObject {
        val rem = JSONObject()
        rem.put("types", JSONArray(remTypes))
        rem.put("quals", JSONArray(remQuals))
        return JSONObject().apply {
            put("name", name)
            put("address", address)
            put("phone", phone)
            put("photo", photo)
            put("district", district)
            put("dob", dob)
            put("edu", edu)
            put("typeBn", typeBn)
            put("typeEn", typeEn)
            put("notes", notes)
            put("remindersEnabled", remindersEnabled)
            put("reminders", rem)
        }
    }

    companion object {
        fun fromJson(o: JSONObject?): Profile {
            if (o == null) return Profile()
            val rem = o.optJSONObject("reminders")
            val types = mutableListOf<String>()
            val quals = mutableListOf<String>()
            rem?.optJSONArray("types")?.let { a ->
                for (i in 0 until a.length()) types.add(a.optString(i))
            }
            rem?.optJSONArray("quals")?.let { a ->
                for (i in 0 until a.length()) quals.add(a.optString(i))
            }
            return Profile(
                name = o.optString("name", ""),
                address = o.optString("address", ""),
                phone = o.optString("phone", ""),
                photo = o.optString("photo", ""),
                district = o.optString("district", ""),
                dob = o.optString("dob", ""),
                edu = o.optString("edu", "HSC"),
                typeBn = o.optInt("typeBn", 20),
                typeEn = o.optInt("typeEn", 20),
                notes = o.optString("notes", ""),
                remindersEnabled = o.optBoolean("remindersEnabled", true),
                remTypes = types,
                remQuals = quals
            )
        }
    }
}

data class UserData(
    var profile: Profile = Profile(),
    var shortlist: MutableSet<String> = mutableSetOf(),
    var status: MutableMap<String, String> = mutableMapOf(),
    var fontSize: String = "medium"
) {
    fun toJson(): JSONObject {
        return JSONObject().apply {
            put("profile", profile.toJson())
            put("shortlist", JSONArray(shortlist.toList()))
            val st = JSONObject()
            for ((k, v) in status) st.put(k, v)
            put("status", st)
            put("fontSize", fontSize)
        }
    }

    companion object {
        fun fromJson(o: JSONObject?): UserData {
            if (o == null) return UserData()
            val short = mutableSetOf<String>()
            o.optJSONArray("shortlist")?.let { a ->
                for (i in 0 until a.length()) short.add(a.optString(i))
            }
            val st = mutableMapOf<String, String>()
            o.optJSONObject("status")?.let { j ->
                val keys = j.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    st[k] = j.optString(k, "")
                }
            }
            return UserData(
                profile = Profile.fromJson(o.optJSONObject("profile")),
                shortlist = short,
                status = st,
                fontSize = o.optString("fontSize", "medium")
            )
        }
    }
}

/** The 13 circular categories + 5 qualification options (same as /api/config). */
object ReminderOptions {
    val TYPES = listOf(
        "govt" to "সরকারি",
        "ministry" to "মন্ত্রণালয় / অধিদপ্তর",
        "bank" to "ব্যাংক",
        "police" to "পুলিশ / সেনা / প্রতিরক্ষা",
        "teacher" to "শিক্ষক / শিক্ষা",
        "health" to "স্বাস্থ্য",
        "railway" to "রেলওয়ে",
        "district" to "জেলা প্রশাসন",
        "tax" to "কর / রাজস্ব / অডিট",
        "court" to "আদালত",
        "private" to "বেসরকারি",
        "ngo" to "এনজিও",
        "other" to "অন্যান্য"
    )
    val QUALS = listOf(
        "HSC" to "HSC",
        "SSC" to "SSC",
        "GRAD" to "স্নাতক",
        "COMPUTER_TYPIST" to "কম্পিউটার টাইপিস্ট",
        "COMPUTER_OPERATOR" to "কম্পিউটার অপারেটর"
    )
    private val GOVT_TYPES = setOf(
        "ministry", "bank", "police", "teacher", "health",
        "railway", "district", "tax", "court", "port"
    )

    /** Same match rule as the website's api/_prefs.js. */
    fun matchesType(c: Circular, selected: List<String>): Boolean {
        if (selected.isEmpty()) return true
        val t = c.type.lowercase()
        for (k in selected) {
            if (k == "govt" && (GOVT_TYPES.contains(t) || t == "govt")) return true
            if (k == "other" && (t == "other" || !GOVT_TYPES.contains(t) &&
                        t != "private" && t != "ngo" && t != "govt")
            ) return true
            if (k == t) return true
        }
        return false
    }

    fun matchesQual(c: Circular, selected: List<String>): Boolean {
        if (selected.isEmpty()) return true
        if (c.posts.isEmpty()) return false
        return selected.any { k ->
            when (k) {
                "HSC" -> c.hscPosts > 0 ||
                    c.posts.any { it.qualification.uppercase().startsWith("HSC") }
                "SSC" -> c.posts.any { it.qualification.uppercase().startsWith("SSC") }
                "GRAD" -> c.posts.any { it.qualification.contains("স্নাতক") }
                "COMPUTER_TYPIST" -> c.posts.any {
                    it.title.contains("কম্পিউটার") &&
                        (it.title.contains("টাইপিস্ট") || it.title.contains("মুদ্রাক্ষরিক"))
                }
                "COMPUTER_OPERATOR" -> c.posts.any {
                    it.title.contains("কম্পিউটার") && it.title.contains("অপারেটর")
                }
                else -> false
            }
        }
    }
}
