package com.arenaweather.app.data.rules

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The shared rule JSON (packages/core/src/rule.ts), as Kotlin. Field names and enum spellings are
 * the wire format; nothing here is Android-specific.
 */

@Serializable
data class Place(
    val label: String,
    val latitude: Double,
    val longitude: Double,
    val timezone: String? = null,
)

@Serializable
data class HoursOfDay(val from: Int, val to: Int)

@Serializable
data class TimeWindow(
    val hoursAhead: Int? = null,
    val daysAhead: Int? = null,
    val hoursOfDay: HoursOfDay? = null,
) {
    val isEmpty: Boolean get() = hoursAhead == null && daysAhead == null && hoursOfDay == null
}

@Serializable
enum class Comparator(val symbol: String) {
    @SerialName("<") LT("<"),
    @SerialName("<=") LTE("<="),
    @SerialName(">") GT(">"),
    @SerialName(">=") GTE(">="),
    @SerialName("==") EQ("=="),
    @SerialName("!=") NEQ("!=");

    companion object {
        fun fromSymbol(s: String): Comparator = entries.first { it.symbol == s }
    }
}

@Serializable
enum class Quantifier {
    @SerialName("any") ANY,
    @SerialName("all") ALL,
}

@Serializable
enum class GroupOperator {
    @SerialName("all") ALL,
    @SerialName("any") ANY,
}

/** A node of the condition tree: `{ "type": "condition", ... }` or `{ "type": "group", ... }`. */
@Serializable(with = RuleNodeSerializer::class)
sealed interface RuleNode {
    val id: String?
}

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class Condition(
    override val id: String? = null,
    val granularity: Granularity,
    val variable: String,
    val comparator: Comparator,
    val value: Double,
    @EncodeDefault val quantifier: Quantifier = Quantifier.ANY,
) : RuleNode {
    @EncodeDefault val type: String = "condition"
}

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class ConditionGroup(
    override val id: String? = null,
    val operator: GroupOperator,
    val children: List<RuleNode>,
) : RuleNode {
    @EncodeDefault val type: String = "group"
}

object RuleNodeSerializer : JsonContentPolymorphicSerializer<RuleNode>(RuleNode::class) {
    override fun selectDeserializer(element: JsonElement): KSerializer<out RuleNode> =
        when (val type = element.jsonObject["type"]?.jsonPrimitive?.content) {
            "condition" -> Condition.serializer()
            "group" -> ConditionGroup.serializer()
            else -> throw IllegalArgumentException("Unknown rule node type: $type")
        }
}

/** What a user authors and `POST/PUT /api/rules` accepts. */
@Serializable
data class RuleDefinition(
    val name: String,
    val place: Place,
    val window: TimeWindow? = null,
    val root: ConditionGroup,
)

/** A stored rule as `GET /api/rules` returns it: the definition plus server bookkeeping. */
@Serializable
data class Rule(
    val id: String,
    val name: String,
    val place: Place,
    val window: TimeWindow? = null,
    val root: ConditionGroup,
    val paused: Boolean = false,
    val armed: Boolean = true,
    val lastEvaluatedAt: String? = null,
    val lastFiredAt: String? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
) {
    fun definition(): RuleDefinition = RuleDefinition(name, place, window, root)
}

fun RuleNode.conditions(): List<Condition> = when (this) {
    is Condition -> listOf(this)
    is ConditionGroup -> children.flatMap { it.conditions() }
}

fun RuleNode.groupDepth(): Int = when (this) {
    is Condition -> 0
    is ConditionGroup -> 1 + (children.maxOfOrNull { it.groupDepth() } ?: 0)
}

const val MAX_GROUP_DEPTH = 5
const val MAX_GROUP_CHILDREN = 20

/** The JSON configuration every wire type in the app uses. */
val WireJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = false
    isLenient = true
}
