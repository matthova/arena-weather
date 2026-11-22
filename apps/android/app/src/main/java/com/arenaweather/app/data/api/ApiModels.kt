package com.arenaweather.app.data.api

import com.arenaweather.app.data.rules.Comparator
import com.arenaweather.app.data.rules.Granularity
import com.arenaweather.app.data.rules.GroupOperator
import com.arenaweather.app.data.rules.Quantifier
import com.arenaweather.app.data.rules.Rule
import com.arenaweather.app.data.rules.WeatherVariable
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Wire types of the API (packages/core/src/client.ts), as Kotlin. */

@Serializable
data class ApiErrorBody(val error: ApiErrorDetail? = null)

@Serializable
data class ApiErrorDetail(val code: String = "unknown", val message: String = "", val issues: JsonElement? = null)

@Serializable
data class ConfigResponse(
    val appName: String = "Weather alerts",
    val googleSignIn: Boolean = false,
    val push: Boolean = false,
    val pushChannels: PushChannels = PushChannels(),
    val devMailbox: Boolean = false,
)

@Serializable
data class PushChannels(val fcm: Boolean = false)

@Serializable
data class ApiUser(
    val id: String,
    val email: String,
    val name: String = "",
    val image: String? = null,
    val emailVerified: Boolean = false,
)

@Serializable
data class MeResponse(val user: ApiUser? = null)

@Serializable
data class SessionResponse(val user: ApiUser? = null, val session: JsonObject? = null)

@Serializable
data class VariablesResponse(val variables: List<WeatherVariable>)

@Serializable
data class PlaceSearchResult(
    val id: Long,
    val name: String,
    val label: String,
    val latitude: Double,
    val longitude: Double,
    val country: String? = null,
    val countryCode: String? = null,
    val admin1: String? = null,
    val timezone: String? = null,
    val population: Long? = null,
)

@Serializable
data class PlacesSearchResponse(val results: List<PlaceSearchResult>)

@Serializable
data class ForecastSeries(
    val time: List<Long>,
    val values: Map<String, List<Double?>>,
)

@Serializable
data class CurrentConditions(val time: Long, val values: Map<String, Double?>)

@Serializable
data class Forecast(
    val latitude: Double,
    val longitude: Double,
    val elevation: Double? = null,
    val timezone: String,
    val utcOffsetSeconds: Int,
    val units: Map<String, String> = emptyMap(),
    val current: CurrentConditions? = null,
    val hourly: ForecastSeries,
    val daily: ForecastSeries,
    val fetchedAt: Long? = null,
) {
    fun hourlyValue(variable: String, index: Int): Double? = hourly.values[variable]?.getOrNull(index)
    fun dailyValue(variable: String, index: Int): Double? = daily.values[variable]?.getOrNull(index)
}

@Serializable
data class RulesListResponse(val rules: List<Rule>)

@Serializable
data class RuleResponse(val rule: Rule)

@Serializable
data class PushCounts(val attempted: Int = 0, val delivered: Int = 0, val failed: Int = 0)

@Serializable
data class RuleTestResponse(
    val rule: Rule,
    val evaluation: RuleEvaluation,
    val message: String,
    val push: PushCounts = PushCounts(),
)

// --- Evaluation tree (packages/core/src/evaluate.ts) ---

@Serializable
data class Sample(val time: Long, val value: Double)

@Serializable(with = NodeResultSerializer::class)
sealed interface NodeResult {
    val holds: Boolean
}

@Serializable
data class ConditionResult(
    val id: String? = null,
    val granularity: Granularity,
    val variable: String,
    val comparator: Comparator,
    val value: Double,
    val quantifier: Quantifier = Quantifier.ANY,
    override val holds: Boolean,
    val sampleCount: Int = 0,
    val matchCount: Int = 0,
    val firstMatch: Sample? = null,
    val missingVariable: Boolean = false,
) : NodeResult

@Serializable
data class GroupResult(
    val id: String? = null,
    val operator: GroupOperator,
    override val holds: Boolean,
    val children: List<NodeResult>,
) : NodeResult

object NodeResultSerializer : JsonContentPolymorphicSerializer<NodeResult>(NodeResult::class) {
    override fun selectDeserializer(element: JsonElement): KSerializer<out NodeResult> =
        when (element.jsonObject["type"]?.jsonPrimitive?.content) {
            "group" -> GroupResult.serializer()
            else -> ConditionResult.serializer()
        }
}

@Serializable
data class RuleEvaluation(val matched: Boolean, val evaluatedAt: Long, val root: GroupResult)

// --- Push devices ---

@Serializable
data class RegisteredDevice(
    val id: String,
    val channel: String = "webpush",
    val endpoint: String,
    val createdAt: String = "",
    val userAgent: String? = null,
)

@Serializable
data class PushListResponse(val subscriptions: List<RegisteredDevice>)

@Serializable
data class DeviceRegistration(val channel: String, val token: String, val userAgent: String? = null)

@Serializable
data class DeviceRegistrationResponse(val device: DeviceInfo, val deliverable: Boolean = false)

@Serializable
data class DeviceInfo(val id: String, val channel: String, val token: String)

@Serializable
data class DeviceUnregistration(val token: String)

// --- Auth bodies ---

@Serializable
data class SignUpBody(val name: String, val email: String, val password: String, val callbackURL: String? = null)

@Serializable
data class SignInBody(val email: String, val password: String)

@Serializable
data class SendVerificationBody(val email: String, val callbackURL: String? = null)

@Serializable
data class SocialSignInBody(val provider: String, val idToken: IdToken)

@Serializable
data class IdToken(val token: String)

@Serializable
data class DevOutboxResponse(val messages: List<DevMail> = emptyList())

@Serializable
data class DevMail(val to: String, val subject: String, val text: String, val sentAt: String = "")
