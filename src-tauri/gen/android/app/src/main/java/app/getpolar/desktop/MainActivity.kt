package app.getpolar.desktop

import android.app.Activity
import android.app.UiModeManager
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  // The payload of the notification that started the app (NotesWorker.kt), until the page takes it.
  private var launchNote: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    keepAboveKeyboard()
    launchNote = intent?.getStringExtra(Notes.EXTRA)
  }

  // A notification clicked while the app runs: the page hears it as a `polar-note` event.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val payload = intent.getStringExtra(Notes.EXTRA) ?: return
    val view = webView
    if (view == null) {
      launchNote = payload
      return
    }
    view.evaluateJavascript("window.dispatchEvent(new CustomEvent('polar-note', { detail: ${JSONObject.quote(payload)} }))", null)
  }

  fun takeLaunchNote(): String? = launchNote.also { launchNote = null }

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

  // The web view arrives here (from wry); mpv's picture goes in a SurfaceView behind it, which shows
  // through while the page is transparent (playing). See src-tauri/src/player/android.rs.
  override fun setContentView(view: View?) {
    if (view == null) return super.setContentView(view)
    val stack = FrameLayout(this)
    val video = SurfaceView(this)
    video.holder.addCallback(MpvSurface)
    stack.addView(video, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
    stack.addView(view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
    super.setContentView(stack)
  }

  // Runs before the first page loads, so the interface can read it while it starts (src/lib/platform/device.ts).
  override fun onWebViewCreate(webView: WebView) {
    // The interface never zooms (#176): a pinch in the player is Fit / Fill, elsewhere nothing. Text size
    // (the web view's textZoom) is separate and still follows the system setting.
    webView.settings.setSupportZoom(false)
    webView.settings.builtInZoomControls = false
    webView.settings.displayZoomControls = false
    webView.addJavascriptInterface(PolarDevice(this, isTelevision()), "polarDevice")
    webView.addJavascriptInterface(PolarNotes(this), "polarNotes")
    this.webView = webView
  }

  private fun isTelevision(): Boolean {
    val uiMode = getSystemService(UI_MODE_SERVICE) as? UiModeManager
    return uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
      packageManager.hasSystemFeature("android.software.leanback")
  }
}

/** What the web view may ask of the device; nothing else is exposed. */
class PolarDevice(private val activity: Activity, private val tv: Boolean) {
  @JavascriptInterface
  fun isTv(): Boolean = tv

  // Back at the root (src/lib/platform/back.ts): to the background, as Android 12 and later do for a
  // launcher's activity. Ending the process instead ran its exit handlers under the web view's render
  // threads, which crashed.
  @JavascriptInterface
  fun leave() {
    activity.runOnUiThread { activity.moveTaskToBack(true) }
  }

  // The player open (src/lib/platform/back.ts, #178): the status and navigation bars hide, and a swipe from
  // the edge shows them for a moment. Closed, they come back.
  @JavascriptInterface
  fun immersive(on: Boolean) {
    activity.runOnUiThread {
      val bars = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
      bars.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      if (on) bars.hide(WindowInsetsCompat.Type.systemBars()) else bars.show(WindowInsetsCompat.Type.systemBars())
    }
  }
}

/** Hands the video surface to mpv in Rust (src-tauri/src/player/android.rs) as it comes and goes. */
object MpvSurface : SurfaceHolder.Callback {
  private external fun created(surface: Surface, width: Int, height: Int)
  private external fun changed(width: Int, height: Int)
  private external fun destroyed()

  override fun surfaceCreated(holder: SurfaceHolder) {
    val frame = holder.surfaceFrame
    created(holder.surface, frame.width(), frame.height())
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = changed(width, height)

  override fun surfaceDestroyed(holder: SurfaceHolder) = destroyed()
}
