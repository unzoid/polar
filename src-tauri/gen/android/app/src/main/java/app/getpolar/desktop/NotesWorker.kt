package app.getpolar.desktop

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

/**
 * Notifications on Android (#209; src/lib/platform/notifications.ts). The page decides what to say;
 * this shows it now, or hands it to WorkManager for its time (episodes with a listed air date), so it
 * arrives with the app closed too. A click opens the activity with the note's payload, which the page
 * checks before acting on.
 */
object Notes {
  const val CHANNEL = "shows"
  const val EXTRA = "app.getpolar.desktop.note"
  private const val TAG = "polar-notes"
  /** Planned at once at most, like iOS's limit. */
  private const val MAX_PLANNED = 60
  private const val MAX_TEXT = 300
  private const val PREFS = "polar-notes"

  fun clip(text: String): String {
    val clean = text.filter { !it.isISOControl() }
    return if (clean.length > MAX_TEXT) clean.take(MAX_TEXT) + "…" else clean
  }

  private fun channel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL) != null) return
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Polarity", NotificationManager.IMPORTANCE_DEFAULT))
  }

  fun show(context: Context, id: String, title: String, body: String, payload: String) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    if (Build.VERSION.SDK_INT >= 33 &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    channel(context)
    val open = Intent(context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra(EXTRA, payload)
    val pending = PendingIntent.getActivity(
      context, id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val note = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(clip(title))
      .setContentText(clip(body))
      .setContentIntent(pending)
      .setAutoCancel(true)
      .build()
    try {
      NotificationManagerCompat.from(context).notify(id, 0, note)
    } catch (e: SecurityException) {
      // Permission taken away in between: nothing to show.
    }
  }

  /** Replaces every planned note with `json`'s ([{id, title, body, payload, at}], at in ms since 1970). */
  fun plan(context: Context, json: String) {
    val work = WorkManager.getInstance(context)
    work.cancelAllWorkByTag(TAG)
    val list = try { JSONArray(json) } catch (e: Exception) { return }
    val now = System.currentTimeMillis()
    for (i in 0 until minOf(list.length(), MAX_PLANNED)) {
      val n = list.optJSONObject(i) ?: continue
      val wait = n.optLong("at") - now
      if (wait < 1000) continue
      val request = OneTimeWorkRequestBuilder<NotesWorker>()
        .setInitialDelay(wait, TimeUnit.MILLISECONDS)
        .setInputData(
          workDataOf(
            "id" to n.optString("id"),
            "title" to clip(n.optString("title")),
            "body" to clip(n.optString("body")),
            "payload" to n.optString("payload"),
          )
        )
        .addTag(TAG)
        .build()
      work.enqueue(request)
    }
  }

  /** "granted", "denied", or "prompt" while Android 13 and later haven't asked yet. */
  fun permission(context: Context): String {
    if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
      if (Build.VERSION.SDK_INT < 33 ||
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
      ) return "granted"
    }
    val asked = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("asked", false)
    return if (Build.VERSION.SDK_INT >= 33 && !asked) "prompt" else "denied"
  }

  fun request(activity: Activity) {
    if (Build.VERSION.SDK_INT < 33) return
    activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("asked", true).apply()
    activity.runOnUiThread { activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 209) }
  }
}

/** Shows one planned note when its time comes. */
class NotesWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val d = inputData
    Notes.show(applicationContext, d.getString("id") ?: return Result.success(), d.getString("title") ?: "", d.getString("body") ?: "", d.getString("payload") ?: "")
    return Result.success()
  }
}

/**
 * What every frame of the web view may read (window.polarNotes): whether notes may be shown. A JavaScript
 * interface reaches a trailer's YouTube frame too, so what shows, plans or hands over notes comes as a message
 * from the app's own pages instead (MainActivity's DeviceActions, `notes:…`).
 */
open class PolarNotes(protected val activity: MainActivity) {
  @JavascriptInterface
  fun permission(): String = Notes.permission(activity)
}

/** A web view without message listeners: the rest stays on the interface too. */
class PolarNotesWithActions(activity: MainActivity) : PolarNotes(activity) {
  @JavascriptInterface
  fun request() = noteAction(activity, "request")

  @JavascriptInterface
  fun show(json: String) = noteAction(activity, "show:$json")

  @JavascriptInterface
  fun plan(json: String) = noteAction(activity, "plan:$json")

  @JavascriptInterface
  fun ready() = noteAction(activity, "ready")
}

/**
 * The page's asks, after `notes:` (src/lib/platform/notifications.ts): `request`, `show:<json>`, `plan:<json>`, and
 * `ready` (the page listens: the note that started the app, and each one clicked later, come as `polar-note` events).
 */
fun noteAction(activity: MainActivity, action: String) {
  val arg = action.substringAfter(':', "")
  when (action.substringBefore(':')) {
    "request" -> Notes.request(activity)
    "show" -> {
      val n = try { JSONObject(arg) } catch (e: Exception) { return }
      Notes.show(activity, n.optString("id"), n.optString("title"), n.optString("body"), n.optString("payload"))
    }
    "plan" -> Notes.plan(activity, arg)
    "ready" -> activity.runOnUiThread { activity.deliverNote(fromPage = true) }
  }
}
