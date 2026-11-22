package com.arenaweather.app

import android.content.Context
import com.arenaweather.app.data.Session
import com.arenaweather.app.data.Settings
import com.arenaweather.app.data.api.ConfigResponse
import com.arenaweather.app.data.api.WeatherApi
import com.arenaweather.app.data.location.LocationSource
import com.arenaweather.app.data.push.PushRegistrar
import com.arenaweather.app.data.rules.VariableCatalogue
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/** Hand-wired dependencies (small app, no DI framework). One per process, owned by [WeatherApp]. */
class AppContainer(context: Context) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val settings = Settings(context)

    // The API origin and token are read on every request so changing the server or signing in
    // needs no client rebuild. Reading DataStore synchronously here is a few microseconds after the
    // first read (it is an in-memory flow once loaded).
    @Volatile private var cached = runBlocking { settings.current() }

    init {
        scope.launch { settings.snapshot.collect { cached = it } }
    }

    val api = WeatherApi(
        baseUrl = { cached.baseUrl },
        token = { cached.sessionToken },
        engine = OkHttp.create(),
        debugLogging = BuildConfig.DEBUG,
    )
    val catalogue = VariableCatalogue()
    val push = PushRegistrar(context, settings, api)
    val session = Session(settings, api, push)
    val location = LocationSource(context)

    private val _config = MutableStateFlow<ConfigResponse?>(null)
    /** `GET /api/config`: what the server offers (Google sign-in, push, dev mailbox). */
    val config: StateFlow<ConfigResponse?> = _config

    fun refreshConfig() {
        scope.launch {
            runCatching { api.config() }.onSuccess { _config.value = it }
            runCatching { api.variables() }.onSuccess { catalogue.update(it.variables) }
        }
    }

    val baseUrl: String get() = cached.baseUrl

    /** Where e-mail links should land: the web app's origin from /api/config, else the API origin. */
    fun webAppUrl(): String = (_config.value?.appUrl?.takeIf { it.isNotBlank() } ?: baseUrl).trimEnd('/')
}
