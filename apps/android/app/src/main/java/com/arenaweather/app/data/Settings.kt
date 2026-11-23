package com.arenaweather.app.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.arenaweather.app.BuildConfig
import com.arenaweather.app.data.rules.Place
import com.arenaweather.app.data.rules.WireJson
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "weather_alerts")

/**
 * Everything the app remembers between launches, in Preferences DataStore: the API origin, the
 * session token (Better Auth bearer token), the signed-in user's e-mail, the FCM token the API
 * knows about, and the last place shown.
 */
class Settings(private val context: Context) {
    private object Keys {
        val baseUrl = stringPreferencesKey("api_base_url")
        val sessionToken = stringPreferencesKey("session_token")
        val userEmail = stringPreferencesKey("user_email")
        val userName = stringPreferencesKey("user_name")
        val fcmToken = stringPreferencesKey("fcm_token")
        val registeredFcmToken = stringPreferencesKey("registered_fcm_token")
        val lastPlace = stringPreferencesKey("last_place")
    }

    data class Snapshot(
        val baseUrl: String,
        val sessionToken: String?,
        val userEmail: String?,
        val userName: String?,
        val fcmToken: String?,
        /** The FCM token the API has (so a rotated token can be re-registered). */
        val registeredFcmToken: String?,
        val lastPlace: Place?,
    )

    val snapshot: Flow<Snapshot> = context.dataStore.data.map { p ->
        Snapshot(
            baseUrl = p[Keys.baseUrl]?.takeIf { it.isNotBlank() } ?: BuildConfig.API_BASE_URL,
            sessionToken = p[Keys.sessionToken],
            userEmail = p[Keys.userEmail],
            userName = p[Keys.userName],
            fcmToken = p[Keys.fcmToken],
            registeredFcmToken = p[Keys.registeredFcmToken],
            lastPlace = p[Keys.lastPlace]?.let { runCatching { WireJson.decodeFromString(Place.serializer(), it) }.getOrNull() },
        )
    }

    suspend fun current(): Snapshot = snapshot.first()

    suspend fun setBaseUrl(url: String) = context.dataStore.edit { it[Keys.baseUrl] = url.trim().trimEnd('/') }

    suspend fun setSession(token: String?, email: String?, name: String?) = context.dataStore.edit {
        if (token == null) it.remove(Keys.sessionToken) else it[Keys.sessionToken] = token
        if (email == null) it.remove(Keys.userEmail) else it[Keys.userEmail] = email
        if (name == null) it.remove(Keys.userName) else it[Keys.userName] = name
    }

    suspend fun setFcmToken(token: String) = context.dataStore.edit { it[Keys.fcmToken] = token }

    suspend fun setRegisteredFcmToken(token: String?) = context.dataStore.edit {
        if (token == null) it.remove(Keys.registeredFcmToken) else it[Keys.registeredFcmToken] = token
    }

    suspend fun setLastPlace(place: Place) = context.dataStore.edit {
        it[Keys.lastPlace] = WireJson.encodeToString(Place.serializer(), place)
    }
}
