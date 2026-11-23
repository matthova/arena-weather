package com.arenaweather.app.data.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import com.arenaweather.app.MainActivity
import com.arenaweather.app.R
import com.arenaweather.app.WeatherApp
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Receives FCM messages. The API sends a `notification` + `data` message (apps/api/src/push/fcm.ts):
 * in the background Android shows it on the `weather_alerts` channel by itself; in the foreground
 * we show it here from the data payload, which carries the same fields the web service worker gets
 * (`title`, `body`, `url`, `tag`, `ruleId`, `matched`).
 */
class AlertsMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        Log.i(TAG, "new FCM token")
        val app = application as WeatherApp
        scope.launch { app.container.push.onNewToken(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = message.notification?.title ?: data["title"] ?: getString(R.string.app_name)
        val body = message.notification?.body ?: data["body"] ?: ""
        showNotification(this, title, body, ruleId = data["ruleId"], tag = data["tag"])
    }

    companion object {
        private const val TAG = "AlertsMessaging"
        const val CHANNEL_ID = "weather_alerts"
        const val EXTRA_RULE_ID = "ruleId"

        fun ensureChannel(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, context.getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH).apply {
                        description = context.getString(R.string.channel_alerts_description)
                    },
                )
            }
        }

        fun showNotification(context: Context, title: String, body: String, ruleId: String?, tag: String?) {
            ensureChannel(context)
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                if (ruleId != null) putExtra(EXTRA_RULE_ID, ruleId)
            }
            val pending = PendingIntent.getActivity(
                context,
                (ruleId ?: tag ?: title).hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pending)
                .build()
            val nm = context.getSystemService(NotificationManager::class.java)
            // one notification per rule (same collapse id the API uses), like the web app's `tag`
            nm.notify(tag ?: "alert", (ruleId ?: tag ?: title).hashCode(), notification)
        }
    }
}
