package app.getpolar.desktop

import android.app.Activity
import android.app.UiModeManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
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
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  // The payload of the notification that started the app or was clicked (NotesWorker.kt), until the page takes it.
  private var launchNote: String? = null
  private var pageHearsNotes = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    keepAboveKeyboard()
    launchNote = intent?.getStringExtra(Notes.EXTRA)
    // Recreated (turned, resized): the link that started it was already handed over.
    if (savedInstanceState == null) IncomingLinks.offer(intent)
  }

  // A link opened or a notification clicked while Polarity runs (the activity is singleTask): to the page at
  // once, once it listens.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    if (IncomingLinks.offer(intent)) deliverLinks()
    intent.getStringExtra(Notes.EXTRA)?.let {
      launchNote = it
      deliverNote()
    }
  }

  // A notification's payload as a `polar-note` event, into the page's main frame only, as links are.
  fun deliverNote(fromPage: Boolean = false) {
    if (fromPage) pageHearsNotes = true
    if (!pageHearsNotes) return
    val payload = launchNote ?: return
    launchNote = null
    webView?.evaluateJavascript("window.dispatchEvent(new CustomEvent('polar-note', { detail: ${JSONObject.quote(payload)} }))", null)
  }

  private var pageListens = false

  // Into the page's main frame only (evaluateJavascript): an embedded frame (a YouTube player) sees
  // polarDevice too, so links are never returned from a call it could make.
  fun deliverLinks(fromPage: Boolean = false) {
    if (fromPage) pageListens = true
    if (!pageListens) return
    val links = IncomingLinks.take() ?: return
    webView?.evaluateJavascript("window.dispatchEvent(new CustomEvent('polar-deep-link', { detail: $links }))", null)
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
    // A JavaScript interface is visible to every frame in the page, a trailer's YouTube frame too. So it only
    // answers isTv(); what changes the window (leave, immersive) or the app (links) comes as a message, which the
    // web view hands over only from the app's own pages. A web view too old for that keeps the calls on the interface.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      webView.addJavascriptInterface(PolarDevice(isTelevision()), "polarDevice")
      webView.addJavascriptInterface(PolarNotes(this), "polarNotes")
      WebViewCompat.addWebMessageListener(webView, "polarActions", appOrigins(), DeviceActions(this))
    } else {
      webView.addJavascriptInterface(PolarDeviceWithActions(this, isTelevision()), "polarDevice")
      webView.addJavascriptInterface(PolarNotesWithActions(this), "polarNotes")
    }
    this.webView = webView
  }

  // The app's pages as Tauri serves them on Android. A debug build may load them from a dev server on any
  // address instead (`tauri android dev`), so it takes messages from any page.
  private fun appOrigins(): Set<String> =
    if (BuildConfig.DEBUG) setOf("*") else setOf("http://tauri.localhost", "https://tauri.localhost")

  private fun isTelevision(): Boolean {
    val uiMode = getSystemService(UI_MODE_SERVICE) as? UiModeManager
    return uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
      packageManager.hasSystemFeature("android.software.leanback")
  }
}

/** What every frame of the web view may read: whether this is a TV. */
open class PolarDevice(private val tv: Boolean) {
  @JavascriptInterface
  fun isTv(): Boolean = tv
}

/**
 * The window and app changes, as messages from the app's own pages (src/lib/platform/back.ts, deepLinks.ts):
 * `leave`, `immersive:on|off`, `links-ready`, `stremio-links:on|off`, and notifications' `notes:…` (NotesWorker.kt).
 */
class DeviceActions(private val activity: MainActivity) : WebViewCompat.WebMessageListener {
  override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
    if (!isMainFrame) return
    val data = message.data ?: return
    when (data) {
      "leave" -> leave(activity)
      "immersive:on" -> immersive(activity, true)
      "immersive:off" -> immersive(activity, false)
      "links-ready" -> linksReady(activity)
      "stremio-links:on" -> setStremioLinks(activity, true)
      "stremio-links:off" -> setStremioLinks(activity, false)
      else -> if (data.startsWith("notes:")) noteAction(activity, data.removePrefix("notes:"))
    }
  }
}

/** A web view without message listeners: the window and app changes stay on the interface. */
class PolarDeviceWithActions(private val activity: Activity, tv: Boolean) : PolarDevice(tv) {
  @JavascriptInterface
  fun leave() = leave(activity)

  @JavascriptInterface
  fun immersive(on: Boolean) = immersive(activity, on)

  @JavascriptInterface
  fun linksReady() = linksReady(activity)

  @JavascriptInterface
  fun setStremioLinks(on: Boolean) = setStremioLinks(activity, on)
}

// Back at the root (src/lib/platform/back.ts): to the background, as Android 12 and later do for a
// launcher's activity. Ending the process instead ran its exit handlers under the web view's render
// threads, which crashed.
private fun leave(activity: Activity) {
  activity.runOnUiThread { activity.moveTaskToBack(true) }
}

// The player open (src/lib/platform/back.ts, #178): the status and navigation bars hide, and a swipe from
// the edge shows them for a moment. Closed, they come back.
private fun immersive(activity: Activity, on: Boolean) {
  activity.runOnUiThread {
    val bars = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
    bars.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    if (on) bars.hide(WindowInsetsCompat.Type.systemBars()) else bars.show(WindowInsetsCompat.Type.systemBars())
  }
}

// The page listens for stremio:// links (#163): the ones waiting come as a `polar-deep-link` event
// (MainActivity.deliverLinks), untrusted text for src/lib/deepLink.
private fun linksReady(activity: Activity) {
  (activity as? MainActivity)?.let { main -> activity.runOnUiThread { main.deliverLinks(fromPage = true) } }
}

// Settings → Add-ons → Open Stremio links in Polarity (#163): the activity alias that receives them
// (AndroidManifest.xml) is off until this turns it on. With Stremio installed too, Android asks which app.
private fun setStremioLinks(activity: Activity, on: Boolean) {
  val alias = ComponentName(activity.packageName, "app.getpolar.desktop.StremioLinks")
  val state = if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
  activity.packageManager.setComponentEnabledSetting(alias, state, PackageManager.DONT_KILL_APP)
}

/**
 * Links meant for Stremio that reached the activity (#163), kept until the page takes them: the one
 * that started the app comes before the page listens. Only stremio:// links, not too long, latest few.
 */
object IncomingLinks {
  private const val MAX_LEN = 4096
  private const val MAX_WAITING = 8
  private val waiting = ArrayDeque<String>()

  @Synchronized
  fun offer(intent: Intent?): Boolean {
    if (intent?.action != Intent.ACTION_VIEW) return false
    val link = intent.dataString ?: return false
    val ours = link.startsWith("stremio://", ignoreCase = true) && link.length <= MAX_LEN && link.all { it in '!'..'~' }
    if (!ours) return false
    waiting.addLast(link)
    while (waiting.size > MAX_WAITING) waiting.removeFirst()
    return true
  }

  /** The waiting links as a JSON array, or null when there are none. */
  @Synchronized
  fun take(): String? {
    if (waiting.isEmpty()) return null
    val links = JSONArray(waiting.toList()).toString()
    waiting.clear()
    return links
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
