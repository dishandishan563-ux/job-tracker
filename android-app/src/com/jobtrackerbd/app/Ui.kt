package com.jobtrackerbd.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import android.widget.Toast
import android.widget.ToggleButton

/** Small shared UI helpers. */
object Ui {
    fun toast(ctx: Context, msg: String) {
        Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()
    }

    private const val ORIG_SIZE_TAG = 0x7F0A0001

    /** Scale every TextView under root by the user's font-size setting (once per view). */
    fun applyTextScale(root: View) {
        val scale = Store.fontScale()
        if (scale == 1.0f) return
        fun walk(v: View) {
            if (v is TextView) {
                val orig = v.getTag(ORIG_SIZE_TAG) as? Float
                if (orig == null) {
                    v.setTag(ORIG_SIZE_TAG, v.textSize)
                    v.setTextSize(TypedValue.COMPLEX_UNIT_PX, v.textSize * scale)
                } else {
                    v.setTextSize(TypedValue.COMPLEX_UNIT_PX, orig * scale)
                }
            }
            if (v is ViewGroup) {
                for (i in 0 until v.childCount) walk(v.getChildAt(i))
            }
        }
        walk(root)
    }

    /** A toggle chip button (used for type / qualification filters).
        Custom pill background + explicit text colors + button drawable
        removed: the device's default ToggleButton draws a horizontal
        groove line through the text and a gray circle indicator, so the
        default rendering must never be used. Slim: 13sp text, 32dp tall. */
    fun chipButton(ctx: Context, label: String, active: Boolean): ToggleButton {
        val density = ctx.resources.displayMetrics.density
        return ToggleButton(ctx).apply {
            textOn = label
            textOff = label
            text = label
            isChecked = active
            textSize = 13f
            minimumHeight = 0
            minHeight = (32 * density).toInt()
            setPadding((16 * density).toInt(), (8 * density).toInt(), (16 * density).toInt(), (8 * density).toInt())
            // No default toggle chrome: no groove line, no circle indicator.
            setButtonDrawable(null)
            background = ctx.getDrawable(R.drawable.chip_bg)
            setTextColor(ctx.getColorStateList(R.color.chip_text))
            val lp = ViewGroup.MarginLayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            lp.setMargins(0, 0, 8, 0)
            layoutParams = lp
        }
    }

    fun openUrl(ctx: Context, url: String) {
        try {
            val i = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            ctx.startActivity(i)
        } catch (e: Exception) {
            toast(ctx, "লিংক খোলা যায়নি।")
        }
    }

    fun statusLabel(status: String?): String = when (status) {
        "applied" -> "✓ আবেদন করেছি (Applied)"
        "fee_paid" -> "✓ ফি দিয়েছি (Fee Paid)"
        "admit" -> "✓ অ্যাডমিট কার্ড পেয়েছি (Admit Card)"
        else -> ""
    }
}
