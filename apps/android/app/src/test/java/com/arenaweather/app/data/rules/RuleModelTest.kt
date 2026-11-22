package com.arenaweather.app.data.rules

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Kotlin model must produce exactly the JSON packages/core's ruleDefinitionSchema accepts (strict objects). */
class RuleModelTest {
    private val readmeExample = """
        {
          "name": "Wet and windy evening",
          "place": { "label": "Berlin", "latitude": 52.52, "longitude": 13.41, "timezone": "Europe/Berlin" },
          "window": { "hoursAhead": 12, "hoursOfDay": { "from": 17, "to": 22 } },
          "root": {
            "type": "group", "operator": "all",
            "children": [
              { "type": "condition", "granularity": "hourly", "variable": "precipitation_probability", "comparator": ">=", "value": 60 },
              { "type": "group", "operator": "any", "children": [
                { "type": "condition", "granularity": "hourly", "variable": "wind_gusts_10m", "comparator": ">", "value": 50 },
                { "type": "condition", "granularity": "daily", "variable": "weather_code", "comparator": "==", "value": 95 }
              ]}
            ]
          }
        }
    """.trimIndent()

    @Test
    fun `parses the README example and serializes it back with only schema fields`() {
        val def = WireJson.decodeFromString(RuleDefinition.serializer(), readmeExample)
        assertEquals("Wet and windy evening", def.name)
        assertEquals(12, def.window?.hoursAhead)
        assertEquals(HoursOfDay(17, 22), def.window?.hoursOfDay)
        assertEquals(GroupOperator.ALL, def.root.operator)
        val first = def.root.children[0] as Condition
        assertEquals(Comparator.GTE, first.comparator)
        assertEquals(60.0, first.value, 0.0)
        assertEquals(Quantifier.ANY, first.quantifier)
        val nested = def.root.children[1] as ConditionGroup
        assertEquals(GroupOperator.ANY, nested.operator)
        assertEquals(Granularity.DAILY, (nested.children[1] as Condition).granularity)

        val out = WireJson.encodeToString(RuleDefinition.serializer(), def)
        val json = Json.parseToJsonElement(out).jsonObject
        assertEquals(setOf("name", "place", "window", "root"), json.keys)
        val root = json["root"]!!.jsonObject
        assertEquals(setOf("type", "operator", "children"), root.keys)
        assertEquals("group", root["type"]!!.jsonPrimitive.content)
        val cond = root["children"]!!.jsonArray[0].jsonObject
        // strict schema: exactly these keys, quantifier always explicit, no nulls
        assertEquals(setOf("type", "granularity", "variable", "comparator", "value", "quantifier"), cond.keys)
        assertEquals("condition", cond["type"]!!.jsonPrimitive.content)
        assertEquals(">=", cond["comparator"]!!.jsonPrimitive.content)
        assertEquals("any", cond["quantifier"]!!.jsonPrimitive.content)
        val window = json["window"]!!.jsonObject
        assertEquals(setOf("hoursAhead", "hoursOfDay"), window.keys)
        assertFalse(out.contains("null"))
    }

    @Test
    fun `stored rules carry server fields and strip them again for editing`() {
        val stored = """{"id":"r1","name":"Rain","place":{"label":"Berlin","latitude":52.52,"longitude":13.41},"root":{"type":"group","operator":"all","children":[{"type":"condition","granularity":"hourly","variable":"rain","comparator":">","value":0.5,"quantifier":"all"}]},"paused":true,"armed":false,"lastEvaluatedAt":"2026-01-01T00:00:00.000Z","lastFiredAt":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","unknownFutureField":1}"""
        val rule = WireJson.decodeFromString(Rule.serializer(), stored)
        assertTrue(rule.paused)
        assertFalse(rule.armed)
        assertNull(rule.lastFiredAt)
        val def = rule.definition()
        val json = Json.parseToJsonElement(WireJson.encodeToString(RuleDefinition.serializer(), def)).jsonObject
        assertEquals(setOf("name", "place", "root"), json.keys)
        assertEquals("all", json["root"]!!.jsonObject["children"]!!.jsonArray[0].jsonObject["quantifier"]!!.jsonPrimitive.content)
    }

    @Test
    fun `tree helpers`() {
        val def = WireJson.decodeFromString(RuleDefinition.serializer(), readmeExample)
        assertEquals(3, def.root.conditions().size)
        assertEquals(2, def.root.groupDepth())
        assertEquals(0, (def.root.children[0]).groupDepth())
    }

    @Test
    fun `the built-in catalogue matches the one in packages core`() {
        assertEquals(20, Variables.hourly.size)
        assertEquals(16, Variables.daily.size)
        assertEquals("km/h", Variables.find("wind_gusts_10m", Granularity.HOURLY)?.unit)
        assertNull(Variables.find("wind_gusts_10m", Granularity.DAILY))
        assertEquals("Weather code (WMO)", Variables.find("weather_code", Granularity.DAILY)?.label)
    }

    @Test
    fun `variables response from the API replaces the catalogue`() {
        val c = VariableCatalogue()
        val fromApi = WireJson.decodeFromString(
            com.arenaweather.app.data.api.VariablesResponse.serializer(),
            """{"variables":[{"name":"temperature_2m","label":"Temp","unit":"°C","granularity":"hourly"},{"name":"new_daily","label":"New","unit":"x","granularity":"daily"}]}""",
        )
        c.update(fromApi.variables)
        assertEquals(listOf("temperature_2m"), c.forGranularity(Granularity.HOURLY).map { it.name })
        assertEquals("New", c.find("new_daily", Granularity.DAILY)?.label)
        c.update(emptyList())
        assertEquals(2, c.all.size)
    }
}
