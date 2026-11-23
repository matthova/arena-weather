package com.arenaweather.app.data.push

import android.content.Context
import android.os.Build
import android.util.Log
import com.arenaweather.app.data.Settings
import com.arenaweather.app.data.api.WeatherApi
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await

/** What the Alerts screen shows about push on this device. */
data class PushStatus(
    /** Firebase is configured in this build (google-services.json was present). */
    val firebaseConfigured: Boolean,
    /** The FCM registration token, once Firebase handed one out. */
    val token: String? = null,
    /** The token the API currently has for this device. */
    val registeredToken: String? = null,
    /** The API can deliver to FCM (FCM_SERVICE_ACCOUNT is set on the server). */
    val serverCanDeliver: Boolean? = null,
    val lastError: String? = null,
) {
    val registered: Boolean get() = token != null && token == registeredToken
}

/**
 * Keeps the API's copy of this device's FCM token in step with Firebase: after sign-in, after a
 * token rotation (`onNewToken`), and on demand from the Alerts screen. Without Firebase configuration
 * everything is a no-op that reports why.
 */
class PushRegistrar(private val context: Context, private val settings: Settings, private val api: WeatherApi) {
    private val _status = MutableStateFlow(PushStatus(firebaseConfigured = FirebaseApp.getApps(context).isNotEmpty()))
    val status: StateFlow<PushStatus> = _status.asStateFlow()

    val firebaseConfigured: Boolean get() = _status.value.firebaseConfigured

    /** Fetch the current FCM token (asks Firebase; cached by the SDK). */
    suspend fun currentToken(): String? {
        if (!firebaseConfigured) return null
        return runCatching { FirebaseMessaging.getInstance().token.await() }
            .onSuccess { settings.setFcmToken(it) }
            .onFailure { e -> _status.value = _status.value.copy(lastError = "Firebase: ${e.message}") }
            .getOrNull()
            ?.also { t -> _status.value = _status.value.copy(token = t) }
    }

    /** Register the token with the API when signed in and it is new or changed. */
    suspend fun syncIfNeeded(force: Boolean = false) {
        val snap = settings.current()
        if (snap.sessionToken == null) return
        val token = currentToken() ?: return
        _status.value = _status.value.copy(registeredToken = snap.registeredFcmToken)
        if (!force && snap.registeredFcmToken == token) return
        register(token)
    }

    suspend fun register(token: String) {
        try {
            val res = api.registerDevice(token, userAgent())
            settings.setRegisteredFcmToken(token)
            _status.value = _status.value.copy(token = token, registeredToken = token, serverCanDeliver = res.deliverable, lastError = null)
        } catch (e: Exception) {
            Log.w(TAG, "device registration failed", e)
            _status.value = _status.value.copy(token = token, lastError = e.message)
            throw e
        }
    }

    /** Called from the messaging service when Firebase rotates the token. */
    suspend fun onNewToken(token: String) {
        settings.setFcmToken(token)
        _status.value = _status.value.copy(token = token)
        if (settings.current().sessionToken != null) runCatching { register(token) }
    }

    suspend fun unregister() {
        val snap = settings.current()
        val token = snap.registeredFcmToken ?: snap.fcmToken ?: return
        try {
            api.unregisterDevice(token)
        } finally {
            settings.setRegisteredFcmToken(null)
            _status.value = _status.value.copy(registeredToken = null)
        }
    }

    companion object {
        private const val TAG = "PushRegistrar"
        fun userAgent(): String = "Android ${Build.VERSION.RELEASE}; ${Build.MANUFACTURER} ${Build.MODEL}"
    }
}
