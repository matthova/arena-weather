package com.arenaweather.app.data.rules

import java.util.UUID

/**
 * The rule builder's editable state (a port of apps/web/src/lib/rule-draft.ts): text fields stay text
 * while typing, every node has a stable key for Compose, and [toDefinition] is the only way out: it
 * produces the shared rule JSON and applies the same checks as the server's schema so the user gets
 * instant feedback (the server checks again).
 */
sealed interface NodeDraft {
    val key: String
}

data class ConditionDraft(
    override val key: String = newKey("c"),
    val granularity: Granularity = Granularity.HOURLY,
    val variable: String = "precipitation_probability",
    val comparator: Comparator = Comparator.GTE,
    val value: String = "60",
    val quantifier: Quantifier = Quantifier.ANY,
) : NodeDraft

data class GroupDraft(
    override val key: String = newKey("g"),
    val operator: GroupOperator = GroupOperator.ALL,
    val children: List<NodeDraft> = listOf(ConditionDraft()),
) : NodeDraft

data class WindowDraft(
    val hoursAhead: String = "",
    val daysAhead: String = "",
    val useHoursOfDay: Boolean = false,
    val hoursFrom: String = "8",
    val hoursTo: String = "20",
)

data class RuleDraft(
    val name: String = "",
    val place: Place? = null,
    val window: WindowDraft = WindowDraft(),
    val root: GroupDraft = GroupDraft(),
)

fun newKey(prefix: String): String = prefix + UUID.randomUUID().toString().take(8)

// --- Rule JSON -> draft -------------------------------------------------------------

fun RuleNode.toDraft(): NodeDraft = when (this) {
    is ConditionGroup -> GroupDraft(operator = operator, children = children.map { it.toDraft() })
    is Condition -> ConditionDraft(
        granularity = granularity,
        variable = variable,
        comparator = comparator,
        value = formatValue(value),
        quantifier = quantifier,
    )
}

fun RuleDefinition.toDraft(): RuleDraft {
    val w = window
    return RuleDraft(
        name = name,
        place = place,
        window = WindowDraft(
            hoursAhead = w?.hoursAhead?.toString() ?: "",
            daysAhead = w?.daysAhead?.toString() ?: "",
            useHoursOfDay = w?.hoursOfDay != null,
            hoursFrom = w?.hoursOfDay?.from?.toString() ?: "8",
            hoursTo = w?.hoursOfDay?.to?.toString() ?: "20",
        ),
        root = root.toDraft() as GroupDraft,
    )
}

/** 60.0 -> "60", 12.5 -> "12.5" */
fun formatValue(v: Double): String = if (v == Math.floor(v) && !v.isInfinite() && Math.abs(v) < 1e15) {
    v.toLong().toString()
} else {
    v.toString()
}

// --- Draft -> rule JSON -------------------------------------------------------------

data class DraftErrors(
    /** Form-level messages. */
    val messages: List<String> = emptyList(),
    /** Per node key. */
    val nodes: Map<String, String> = emptyMap(),
) {
    val isEmpty: Boolean get() = messages.isEmpty() && nodes.isEmpty()
}

sealed interface DraftResult {
    data class Ok(val definition: RuleDefinition) : DraftResult
    data class Invalid(val errors: DraftErrors) : DraftResult
}

private fun parseNumber(s: String): Double? {
    val t = s.trim().replace(',', '.')
    if (t.isEmpty()) return null
    val n = t.toDoubleOrNull() ?: return null
    return if (n.isFinite()) n else null
}

private fun parseInt(s: String, range: IntRange, label: String, messages: MutableList<String>): Int? {
    val t = s.trim()
    if (t.isEmpty()) return null
    val n = t.toIntOrNull()
    if (n == null || n !in range) {
        messages += "$label must be a whole number between ${range.first} and ${range.last}"
        return null
    }
    return n
}

private fun nodeToModel(
    node: NodeDraft,
    catalogue: VariableCatalogue,
    nodes: MutableMap<String, String>,
): RuleNode = when (node) {
    is GroupDraft -> {
        if (node.children.isEmpty()) nodes[node.key] = "Add at least one condition to this group"
        if (node.children.size > MAX_GROUP_CHILDREN) nodes[node.key] = "At most $MAX_GROUP_CHILDREN conditions in one group"
        ConditionGroup(operator = node.operator, children = node.children.map { nodeToModel(it, catalogue, nodes) })
    }
    is ConditionDraft -> {
        val value = parseNumber(node.value)
        if (catalogue.find(node.variable, node.granularity) == null) {
            nodes[node.key] = "Pick a ${node.granularity.wire} variable"
        } else if (value == null) {
            nodes[node.key] = "Enter a number"
        }
        Condition(
            granularity = node.granularity,
            variable = node.variable,
            comparator = node.comparator,
            value = value ?: 0.0,
            quantifier = node.quantifier,
        )
    }
}

fun RuleDraft.toDefinition(catalogue: VariableCatalogue = VariableCatalogue()): DraftResult {
    val messages = mutableListOf<String>()
    val nodes = mutableMapOf<String, String>()

    val name = name.trim()
    if (name.isEmpty()) messages += "Give the rule a name"
    if (name.length > 120) messages += "The name is too long (120 characters max)"
    val place = place
    if (place == null) messages += "Pick a place"

    val hoursAhead = parseInt(window.hoursAhead, 1..168, "Hours ahead", messages)
    val daysAhead = parseInt(window.daysAhead, 1..7, "Days ahead", messages)
    var hoursOfDay: HoursOfDay? = null
    if (window.useHoursOfDay) {
        val from = parseInt(window.hoursFrom, 0..23, "Hours of day (from)", messages)
        val to = parseInt(window.hoursTo, 0..23, "Hours of day (to)", messages)
        if (from == null || to == null) {
            if (window.hoursFrom.isBlank() || window.hoursTo.isBlank()) messages += "Hours of day need both a from and a to hour"
        } else {
            hoursOfDay = HoursOfDay(from, to)
        }
    }

    val root = nodeToModel(root, catalogue, nodes) as ConditionGroup
    if (root.groupDepth() > MAX_GROUP_DEPTH) messages += "Groups may be nested at most $MAX_GROUP_DEPTH levels deep"

    if (messages.isNotEmpty() || nodes.isNotEmpty() || place == null) {
        return DraftResult.Invalid(DraftErrors(messages, nodes))
    }
    val window = TimeWindow(hoursAhead, daysAhead, hoursOfDay).takeUnless { it.isEmpty }
    return DraftResult.Ok(RuleDefinition(name = name, place = place, window = window, root = root))
}

// --- Tree edits (immutable: each returns a new root) --------------------------------

fun GroupDraft.mapNode(key: String, f: (NodeDraft) -> NodeDraft?): GroupDraft {
    fun walk(n: NodeDraft): NodeDraft? {
        if (n.key == key) return f(n)
        return if (n is GroupDraft) n.copy(children = n.children.mapNotNull { walk(it) }) else n
    }
    return (walk(this) ?: this) as GroupDraft
}

fun GroupDraft.updateCondition(key: String, f: (ConditionDraft) -> ConditionDraft): GroupDraft =
    mapNode(key) { if (it is ConditionDraft) f(it) else it }

fun GroupDraft.updateGroup(key: String, f: (GroupDraft) -> GroupDraft): GroupDraft =
    mapNode(key) { if (it is GroupDraft) f(it) else it }

fun GroupDraft.addChild(groupKey: String, child: NodeDraft): GroupDraft =
    updateGroup(groupKey) { it.copy(children = it.children + child) }

/** Remove a node; the root cannot be removed. */
fun GroupDraft.removeNode(key: String): GroupDraft = if (key == this.key) this else mapNode(key) { null }

// --- Human text (same wording as packages/core describeCondition) -------------------

fun describeCondition(
    variable: String,
    granularity: Granularity,
    comparator: Comparator,
    value: Double,
    catalogue: VariableCatalogue = VariableCatalogue(),
): String {
    val v = catalogue.find(variable, granularity)
    val label = v?.label ?: variable
    val unit = if (v != null && v.unit != "code" && v.unit != "0/1" && v.unit != "index") " ${v.unit}" else ""
    return "$label ${comparator.symbol} ${formatValue(value)}$unit"
}

fun Condition.describe(catalogue: VariableCatalogue = VariableCatalogue()): String =
    describeCondition(variable, granularity, comparator, value, catalogue)

/** "all of: A; any of: (B; C)" — a one-line summary for the rules list. */
fun RuleNode.summary(catalogue: VariableCatalogue = VariableCatalogue()): String = when (this) {
    is Condition -> describe(catalogue)
    is ConditionGroup -> {
        val joiner = if (operator == GroupOperator.ALL) " and " else " or "
        children.joinToString(joiner) { c -> if (c is ConditionGroup) "(" + c.summary(catalogue) + ")" else c.summary(catalogue) }
    }
}

fun TimeWindow?.describe(): String {
    if (this == null || isEmpty) return "next 24 h / 7 days"
    val parts = mutableListOf<String>()
    hoursAhead?.let { parts += "next $it h" }
    daysAhead?.let { parts += "next $it day" + (if (it == 1) "" else "s") }
    hoursOfDay?.let { parts += "%02d:00–%02d:59".format(it.from, it.to) }
    return parts.joinToString(", ")
}
