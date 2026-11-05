package app.getpolar.desktop

import android.app.UiModeManager
import android.content.res.Configuration
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
