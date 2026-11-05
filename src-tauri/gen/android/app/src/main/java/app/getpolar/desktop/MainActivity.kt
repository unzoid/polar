package app.getpolar.desktop

import android.app.UiModeManager
import android.content.res.Configuration
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    keepAboveKeyboard()
  }

  // Edge to edge, the system no longer shrinks the window for the on-screen keyboard (adjustResize is
  // ignored from Android 15), so the web view is made to end at the keyboard's top here: the page gets
  // shorter and the focused field scrolls into view (src/lib/ui/keyboard.ts). The part the navigation bar
  // already covers is left out: the page's CSS pads for it (env(safe-area-inset-bottom)).
  private fun keepAboveKeyboard() {
    val content = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom
      view.setPadding(0, 0, 0, (ime - bars).coerceAtLeast(0))
      insets
    }
  }

  // Runs before the first page loads, so the interface can read it while it starts (src/lib/platform/device.ts).
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(PolarDevice(isTelevision()), "polarDevice")
  }

  private fun isTelevision(): Boolean {
    val uiMode = getSystemService(UI_MODE_SERVICE) as? UiModeManager
    return uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
      packageManager.hasSystemFeature("android.software.leanback")
  }
}

/** What the web view may ask about the device; nothing else is exposed. */
class PolarDevice(private val tv: Boolean) {
  @JavascriptInterface
  fun isTv(): Boolean = tv
}
