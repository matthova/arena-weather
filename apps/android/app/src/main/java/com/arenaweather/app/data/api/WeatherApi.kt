package com.arenaweather.app.data.api

import com.arenaweather.app.data.rules.RuleDefinition
import com.arenaweather.app.data.rules.WireJson
import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.call.body
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logging
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The typed API client (a port of packages/core/src/client.ts, `createWeatherClient`).
 * Every call goes to `baseUrl()` + path and carries `Authorization: Bearer <token>` when a session
 * token is known (Better Auth's bearer plugin); sign-in responses hand the token back through
 * `set-auth-token`.
 */
class WeatherApi(
    private val baseUrl: () -> String,
    private val token: () -> String?,
    engine: HttpClientEngine? = null,
    debugLogging: Boolean = false,
) {
    private val configure: HttpClientConfig<*>.() -> Unit = {
        expectSuccess = false
        install(ContentNegotiation) { json(WireJson) }
        install(HttpTimeout) {
            connectTimeoutMillis = 15_000
            requestTimeoutMillis = 30_000
        }
        if (debugLogging) install(Logging) { level = LogLevel.INFO }
    }
    private val client: HttpClient = if (engine != null) HttpClient(engine, configure) else HttpClient(configure)

    private fun url(path: String): String = baseUrl().trimEnd('/') + path

    private suspend fun raw(method: HttpMethod, path: String, body: Any? = null, configure: HttpRequestBuilder.() -> Unit = {}): HttpResponse =
        client.request(url(path)) {
            this.method = method
            header(HttpHeaders.Accept, "application/json")
            token()?.let { header(HttpHeaders.Authorization, "Bearer $it") }
            if (body != null) {
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            configure()
        }

    private suspend inline fun <reified T> call(method: HttpMethod, path: String, body: Any? = null, noinline configure: HttpRequestBuilder.() -> Unit = {}): T {
        val res = raw(method, path, body, configure)
        if (!res.status.isSuccess()) throw res.toApiException()
        if (res.status == HttpStatusCode.NoContent || T::class == Unit::class) return Unit as T
        return res.body()
    }

    // --- meta ---
    suspend fun config(): ConfigResponse = call(HttpMethod.Get, "/api/config")
    suspend fun variables(): VariablesResponse = call(HttpMethod.Get, "/api/variables")
    suspend fun me(): MeResponse = call(HttpMethod.Get, "/api/me")
    suspend fun devOutbox(to: String): DevOutboxResponse = call(HttpMethod.Get, "/api/dev/outbox") { parameter("to", to) }

    // --- places & forecast ---
    suspend fun searchPlaces(query: String, count: Int = 8): PlacesSearchResponse =
        call(HttpMethod.Get, "/api/places/search") {
            parameter("q", query)
            parameter("count", count)
        }

    suspend fun forecast(latitude: Double, longitude: Double, timezone: String? = null): Forecast =
        call(HttpMethod.Get, "/api/forecast") {
            parameter("latitude", latitude)
            parameter("longitude", longitude)
            if (timezone != null) parameter("timezone", timezone)
        }

    // --- rules ---
    suspend fun listRules(): RulesListResponse = call(HttpMethod.Get, "/api/rules")
    suspend fun getRule(id: String): RuleResponse = call(HttpMethod.Get, "/api/rules/${id.enc()}")
    suspend fun createRule(definition: RuleDefinition): RuleResponse = call(HttpMethod.Post, "/api/rules", definition)
    suspend fun updateRule(id: String, definition: RuleDefinition): RuleResponse = call(HttpMethod.Put, "/api/rules/${id.enc()}", definition)
    suspend fun deleteRule(id: String): Unit = call(HttpMethod.Delete, "/api/rules/${id.enc()}")
    suspend fun pauseRule(id: String): RuleResponse = call(HttpMethod.Post, "/api/rules/${id.enc()}/pause")
    suspend fun resumeRule(id: String): RuleResponse = call(HttpMethod.Post, "/api/rules/${id.enc()}/resume")
    suspend fun testRule(id: String): RuleTestResponse = call(HttpMethod.Post, "/api/rules/${id.enc()}/test")

    // --- push ---
    suspend fun listDevices(): PushListResponse = call(HttpMethod.Get, "/api/push/subscriptions")
    suspend fun registerDevice(token: String, userAgent: String): DeviceRegistrationResponse =
        call(HttpMethod.Post, "/api/push/devices", DeviceRegistration("fcm", token, userAgent))
    suspend fun unregisterDevice(token: String): Unit = call(HttpMethod.Delete, "/api/push/devices", DeviceUnregistration(token))

    // --- auth (Better Auth) ---

    /** The signed-in user plus the bearer token from `set-auth-token`. */
    data class SignedIn(val user: ApiUser, val token: String)

    suspend fun signUp(name: String, email: String, password: String, callbackURL: String?): Unit =
        call(HttpMethod.Post, "/api/auth/sign-up/email", SignUpBody(name, email, password, callbackURL))

    suspend fun signIn(email: String, password: String): SignedIn =
        signedIn(raw(HttpMethod.Post, "/api/auth/sign-in/email", SignInBody(email, password)))

    suspend fun signInWithGoogleIdToken(idToken: String): SignedIn =
        signedIn(raw(HttpMethod.Post, "/api/auth/sign-in/social", SocialSignInBody("google", IdToken(idToken))))

    suspend fun sendVerificationEmail(email: String, callbackURL: String?): Unit =
        call(HttpMethod.Post, "/api/auth/send-verification-email", SendVerificationBody(email, callbackURL))

    suspend fun session(): SessionResponse {
        val res = raw(HttpMethod.Get, "/api/auth/get-session")
        if (!res.status.isSuccess()) throw res.toApiException()
        val text = res.bodyAsText()
        if (text.isBlank() || text == "null") return SessionResponse()
        return WireJson.decodeFromString(SessionResponse.serializer(), text)
    }

    suspend fun signOut() {
        val res = raw(HttpMethod.Post, "/api/auth/sign-out")
        if (!res.status.isSuccess() && res.status != HttpStatusCode.Unauthorized) throw res.toApiException()
    }

    private suspend fun signedIn(res: HttpResponse): SignedIn {
        if (!res.status.isSuccess()) throw res.toApiException()
        val token = res.headers["set-auth-token"]
            ?: throw ApiException(res.status.value, "no_token", "The server did not return a session token (is the bearer plugin enabled?)")
        val body = WireJson.parseToJsonElement(res.bodyAsText()).jsonObject
        val user = body["user"]?.let { WireJson.decodeFromJsonElement(ApiUser.serializer(), it) }
            ?: throw ApiException(res.status.value, "no_user", "The server did not return the user")
        return SignedIn(user, token)
    }

    private fun String.enc(): String = java.net.URLEncoder.encode(this, "UTF-8")

    companion object {
        /** Builds an [ApiException] from an error response of either shape the server uses. */
        suspend fun HttpResponse.toApiException(): ApiException {
            val text = runCatching { bodyAsText() }.getOrDefault("")
            val json: JsonObject? = runCatching { WireJson.parseToJsonElement(text).jsonObject }.getOrNull()
            // API: { error: { code, message, issues } }; Better Auth: { code, message }
            val err = json?.get("error")?.let { runCatching { it.jsonObject }.getOrNull() } ?: json
            val code = err?.get("code")?.jsonPrimitive?.content ?: "http_$status"
            val message = err?.get("message")?.jsonPrimitive?.content
                ?: text.take(200).ifBlank { "Request failed with status ${status.value}" }
            val issues = err?.get("issues")?.toString()
            return ApiException(status.value, code, message, issues)
        }
    }
}

private fun HttpStatusCode.isSuccess(): Boolean = value in 200..299
