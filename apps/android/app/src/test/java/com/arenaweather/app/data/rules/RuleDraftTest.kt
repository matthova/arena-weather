package com.arenaweather.app.data.rules

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A port of apps/web/src/lib/rule-draft.test.ts: the builder's state -> the shared rule JSON, with the schema's checks. */
class RuleDraftTest {
    private val berlin = Place("Berlin", 52.52, 13.41, "Europe/Berlin")

    private fun ok(d: RuleDraft): RuleDefinition = (d.toDefinition() as DraftResult.Ok).definition
    private fun invalid(d: RuleDraft): DraftErrors = (d.toDefinition() as DraftResult.Invalid).errors

    @Test
    fun `a simple draft becomes a valid definition without a window`() {
        val def = ok(RuleDraft(name = " Rain ", place = berlin))
        assertEquals("Rain", def.name)
        assertEquals(berlin, def.place)
        assertNull(def.window)
        val c = def.root.children.single() as Condition
        assertEquals(Condition(null, Granularity.HOURLY, "precipitation_probability", Comparator.GTE, 60.0, Quantifier.ANY), c)
    }

    @Test
    fun `numbers accept decimal commas and the window is only emitted when set`() {
        val d = RuleDraft(
            name = "Cold night",
            place = berlin,
            window = WindowDraft(hoursAhead = "12", daysAhead = "", useHoursOfDay = true, hoursFrom = "22", hoursTo = "6"),
            root = GroupDraft(operator = GroupOperator.ANY, children = listOf(ConditionDraft(variable = "temperature_2m", comparator = Comparator.LT, value = "-2,5", quantifier = Quantifier.ALL))),
        )
        val def = ok(d)
        assertEquals(TimeWindow(hoursAhead = 12, daysAhead = null, hoursOfDay = HoursOfDay(22, 6)), def.window)
        assertEquals(-2.5, (def.root.children[0] as Condition).value, 0.0)
        assertEquals(Quantifier.ALL, (def.root.children[0] as Condition).quantifier)
        // hours of day unchecked: ignored even if filled
        assertNull(ok(d.copy(window = WindowDraft(useHoursOfDay = false, hoursFrom = "1", hoursTo = "2"))).window)
    }

    @Test
    fun `missing name and place, bad numbers and empty groups are reported where they are`() {
        val cond = ConditionDraft(value = "lots")
        val empty = GroupDraft(operator = GroupOperator.ANY, children = emptyList())
        val d = RuleDraft(name = "", place = null, window = WindowDraft(hoursAhead = "500"), root = GroupDraft(children = listOf(cond, empty)))
        val errors = invalid(d)
        assertTrue(errors.messages.any { it.contains("name") })
        assertTrue(errors.messages.any { it.contains("place") })
        assertTrue(errors.messages.any { it.contains("Hours ahead") })
        assertEquals("Enter a number", errors.nodes[cond.key])
        assertEquals("Add at least one condition to this group", errors.nodes[empty.key])
    }

    @Test
    fun `a variable of the wrong granularity is rejected`() {
        val bad = ConditionDraft(granularity = Granularity.DAILY, variable = "wind_gusts_10m", value = "50")
        val errors = invalid(RuleDraft(name = "x", place = berlin, root = GroupDraft(children = listOf(bad))))
        assertEquals("Pick a daily variable", errors.nodes[bad.key])
    }

    @Test
    fun `nesting deeper than five levels is refused`() {
        var g: GroupDraft = GroupDraft()
        repeat(5) { g = GroupDraft(children = listOf(g)) }
        val errors = invalid(RuleDraft(name = "deep", place = berlin, root = g))
        assertTrue(errors.messages.any { it.contains("nested") })
        var fine: GroupDraft = GroupDraft()
        repeat(4) { fine = GroupDraft(children = listOf(fine)) }
        assertEquals(5, ok(RuleDraft(name = "ok", place = berlin, root = fine)).root.groupDepth())
    }

    @Test
    fun `definition to draft and back is lossless`() {
        val def = ok(
            RuleDraft(
                name = "Round trip", place = berlin,
                window = WindowDraft(hoursAhead = "6", daysAhead = "3", useHoursOfDay = true, hoursFrom = "8", hoursTo = "20"),
                root = GroupDraft(
                    operator = GroupOperator.ALL,
                    children = listOf(
                        ConditionDraft(variable = "rain", comparator = Comparator.GT, value = "0.5"),
                        GroupDraft(operator = GroupOperator.ANY, children = listOf(ConditionDraft(granularity = Granularity.DAILY, variable = "uv_index_max", comparator = Comparator.GTE, value = "7"))),
                    ),
                ),
            ),
        )
        val again = ok(def.toDraft())
        assertEquals(def, again)
        assertEquals("0.5", (def.toDraft().root.children[0] as ConditionDraft).value)
        assertEquals("7", ((def.toDraft().root.children[1] as GroupDraft).children[0] as ConditionDraft).value)
    }

    @Test
    fun `tree edits keep every other node`() {
        val a = ConditionDraft(value = "1")
        val b = ConditionDraft(value = "2")
        val inner = GroupDraft(operator = GroupOperator.ANY, children = listOf(b))
        val root = GroupDraft(children = listOf(a, inner))
        val edited = root.updateCondition(b.key) { it.copy(value = "20") }
        assertEquals("20", ((edited.children[1] as GroupDraft).children[0] as ConditionDraft).value)
        assertEquals("1", (edited.children[0] as ConditionDraft).value)
        val added = root.addChild(inner.key, ConditionDraft(value = "3"))
        assertEquals(2, (added.children[1] as GroupDraft).children.size)
        val removed = root.removeNode(inner.key)
        assertEquals(listOf(a.key), removed.children.map { it.key })
        assertEquals(root, root.removeNode(root.key))
        val flipped = root.updateGroup(inner.key) { it.copy(operator = GroupOperator.ALL) }
        assertEquals(GroupOperator.ALL, (flipped.children[1] as GroupDraft).operator)
    }

    @Test
    fun `descriptions use the core wording`() {
        assertEquals("Precipitation chance >= 60 %", describeCondition("precipitation_probability", Granularity.HOURLY, Comparator.GTE, 60.0))
        assertEquals("Weather code (WMO) == 95", describeCondition("weather_code", Granularity.DAILY, Comparator.EQ, 95.0))
        assertEquals("UV index > 7.5", describeCondition("uv_index", Granularity.HOURLY, Comparator.GT, 7.5))
        assertEquals("mystery < 1", describeCondition("mystery", Granularity.HOURLY, Comparator.LT, 1.0))
        val def = ok(RuleDraft(name = "x", place = berlin, root = GroupDraft(children = listOf(ConditionDraft(), GroupDraft(operator = GroupOperator.ANY, children = listOf(ConditionDraft(variable = "wind_gusts_10m", comparator = Comparator.GT, value = "50"), ConditionDraft(granularity = Granularity.DAILY, variable = "weather_code", comparator = Comparator.EQ, value = "95")))))))
        assertEquals("Precipitation chance >= 60 % and (Wind gusts (10 m) > 50 km/h or Weather code (WMO) == 95)", def.root.summary())
        assertEquals("next 24 h / 7 days", (null as TimeWindow?).describe())
        assertEquals("next 12 h, next 1 day, 17:00–22:59", TimeWindow(12, 1, HoursOfDay(17, 22)).describe())
    }
}
