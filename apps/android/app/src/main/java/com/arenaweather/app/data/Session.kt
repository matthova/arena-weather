package com.arenaweather.app.data

import com.arenaweather.app.data.api.ApiUser
import com.arenaweather.app.data.api.WeatherApi
import com.arenaweather.app.data.push.PushRegistrar
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Who is signed in, as the screens see it. */
sealed interface AuthState {
    data object Loading : AuthState
    data object SignedOut : AuthState
    data class SignedIn(val user: ApiUser) : AuthState
}

/**
 * The session: a bearer token in [Settings] plus the user it belongs to. Sign-in stores the token
 * and registers this device for push; sign-out unregisters the device first, then forgets the token.
 */
class Session(
    private val settings: Settings,
    private val api: WeatherApi,
    private val push: PushRegistrar,
) {
    private val _state = MutableStateFlow<AuthState>(AuthState.Loading)
    val state: StateFlow<AuthState> = _state.asStateFlow()

    /** On launch: ask the server whether the stored token is still a session. */
    suspend fun restore() {
        val snap = settings.current()
        if (snap.sessionToken == null) {
            _state.value = AuthState.SignedOut
            return
        }
        val user = runCatching { api.me().user }.getOrElse { e ->
            // offline: trust the stored session until the server says otherwise
            if (e is com.arenaweather.app.data.api.ApiException && e.isUnauthorized) null
            else ApiUser(id = "", email = snap.userEmail ?: "", name = snap.userName ?: "")
        }
        if (user == null) {
            settings.setSession(null, null, null)
            _state.value = AuthState.SignedOut
        } else {
            _state.value = AuthState.SignedIn(user)
            push.syncIfNeeded()
        }
    }

    suspend fun signedIn(result: WeatherApi.SignedIn) {
        settings.setSession(result.token, result.user.email, result.user.name)
        _state.value = AuthState.SignedIn(result.user)
        push.syncIfNeeded()
    }

    suspend fun signOut() {
        runCatching { push.unregister() }
        runCatching { api.signOut() }
        settings.setSession(null, null, null)
        _state.value = AuthState.SignedOut
    }

    /** The server answered 401: the session is gone. */
    suspend fun expired() {
        settings.setSession(null, null, null)
        settings.setRegisteredFcmToken(null)
        _state.value = AuthState.SignedOut
    }
}
