package com.arenaweather.app.data.api

import com.arenaweather.app.data.rules.Comparator
import com.arenaweather.app.data.rules.Condition
import com.arenaweather.app.data.rules.ConditionGroup
import com.arenaweather.app.data.rules.Granularity
import com.arenaweather.app.data.rules.GroupOperator
import com.arenaweather.app.data.rules.Place
import com.arenaweather.app.data.rules.RuleDefinition
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.content.TextContent
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** The client against a fake server: paths, bearer header, bodies, both error shapes, and the response models. */
class WeatherApiTest {
    private val requests = mutableListOf<HttpRequestData>()
    private var token: String? = null

    private fun api(handler: (HttpRequestData) -> Pair<HttpStatusCode, String>, extraHeaders: Map<String, String> = emptyMap()): WeatherApi {
        val engine = MockEngine { req ->
            requests += req
            val (status, body) = handler(req)
            respond(body, status, headersOf(HttpHeaders.ContentType to listOf("application/json"), *extraHeaders.map { it.key to listOf(it.value) }.toTypedArray()))
        }
        return WeatherApi(baseUrl = { "http://api.test/" }, token = { token }, engine = engine)
    }

    private val HttpRequestData.bodyText: String get() = (body as TextContent).text

    @Test
    fun `sends the bearer token and json bodies to the right paths`() = runTest {
        token = "tok123"
        val a = api({ req ->
            when (req.url.encodedPath) {
                "/api/rules" -> HttpStatusCode.Created to """{"rule":{"id":"r1","name":"Rain","place":{"label":"B","latitude":1.0,"longitude":2.0},"root":{"type":"group","operator":"all","children":[]},"paused":false,"armed":true,"createdAt":"","updatedAt":""}}"""
                "/api/rules/r1" -> HttpStatusCode.NoContent to ""
                "/api/push/devices" -> HttpStatusCode.Created to """{"device":{"id":"d","channel":"fcm","token":"t"},"deliverable":true}"""
                else -> HttpStatusCode.NotFound to """{"error":{"code":"not_found","message":"Not found"}}"""
            }
        })
        val def = RuleDefinition("Rain", Place("B", 1.0, 2.0), null, ConditionGroup(operator = GroupOperator.ALL, children = listOf(Condition(granularity = Granularity.HOURLY, variable = "rain", comparator = Comparator.GT, value = 0.0))))
        val created = a.createRule(def)
        assertEquals("r1", created.rule.id)
        a.deleteRule("r1")
        val reg = a.registerDevice("fcm-token-abc", "Android 14")
        assertTrue(reg.deliverable)

        assertEquals(HttpMethod.Post, requests[0].method)
        assertEquals("http://api.test/api/rules", requests[0].url.toString())
        assertEquals("Bearer tok123", requests[0].headers[HttpHeaders.Authorization])
        val sent = Json.parseToJsonElement(requests[0].bodyText).jsonObject
        assertEquals("Rain", sent["name"]!!.jsonPrimitive.content)
        assertEquals(HttpMethod.Delete, requests[1].method)
        assertEquals("""{"channel":"fcm","token":"fcm-token-abc","userAgent":"Android 14"}""", requests[2].bodyText)
    }

    @Test
    fun `no token means no authorization header, and query parameters are encoded`() = runTest {
        token = null
        val a = api({ HttpStatusCode.OK to """{"results":[{"id":1,"name":"Berlin","label":"Berlin, Germany","latitude":52.52,"longitude":13.41,"timezone":"Europe/Berlin"}]}""" })
        val r = a.searchPlaces("Ber lin")
        assertEquals("Europe/Berlin", r.results[0].timezone)
        assertNull(requests[0].headers[HttpHeaders.Authorization])
        assertEquals("Ber+lin", requests[0].url.parameters["q"]?.replace(' ', '+'))
        assertEquals("8", requests[0].url.parameters["count"])
    }

    @Test
    fun `api errors and better-auth errors both become ApiException`() = runTest {
        val a = api({ req ->
            if (req.url.encodedPath.startsWith("/api/auth/")) HttpStatusCode.Forbidden to """{"code":"EMAIL_NOT_VERIFIED","message":"Email not verified"}"""
            else HttpStatusCode.Unauthorized to """{"error":{"code":"unauthorized","message":"Sign in required"}}"""
        })
        try {
            a.listRules()
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(401, e.status)
            assertEquals("unauthorized", e.code)
            assertTrue(e.isUnauthorized)
            assertEquals("Please sign in again", e.userMessage())
        }
        try {
            a.signIn("a@b.c", "pw")
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(403, e.status)
            assertTrue(e.isEmailNotVerified)
            assertEquals("Email not verified", e.message)
        }
    }

    @Test
    fun `sign-in reads the session token from set-auth-token`() = runTest {
        val a = api({ HttpStatusCode.OK to """{"redirect":false,"token":"x","user":{"id":"u1","email":"a@b.c","name":"Ada","emailVerified":true,"createdAt":"","updatedAt":""}}""" }, mapOf("set-auth-token" to "session-token-1"))
        val s = a.signIn("a@b.c", "pw")
        assertEquals("session-token-1", s.token)
        assertEquals("Ada", s.user.name)
        assertEquals("""{"email":"a@b.c","password":"pw"}""", requests[0].bodyText)
    }

    @Test
    fun `sign-in without the bearer plugin is a readable error`() = runTest {
        val a = api({ HttpStatusCode.OK to """{"user":{"id":"u1","email":"a@b.c"}}""" })
        try {
            a.signIn("a@b.c", "pw")
            fail()
        } catch (e: ApiException) {
            assertEquals("no_token", e.code)
        }
    }

    @Test
    fun `forecast, test result and config parse`() = runTest {
        val a = api({ req ->
            when (req.url.encodedPath) {
                "/api/forecast" -> HttpStatusCode.OK to """{"latitude":52.5,"longitude":13.4,"timezone":"Europe/Berlin","utcOffsetSeconds":3600,"units":{"temperature_2m":"°C"},"current":{"time":1700000000,"values":{"temperature_2m":4.5,"is_day":1}},"hourly":{"time":[1700000000,1700003600],"values":{"temperature_2m":[4.5,null]}},"daily":{"time":[1699999200],"values":{"temperature_2m_max":[6]}}}"""
                "/api/rules/r1/test" -> HttpStatusCode.OK to """{"rule":{"id":"r1","name":"Rain","place":{"label":"B","latitude":1,"longitude":2},"root":{"type":"group","operator":"all","children":[]}},"evaluation":{"matched":true,"evaluatedAt":1700000000,"root":{"type":"group","operator":"all","holds":true,"children":[{"type":"condition","granularity":"hourly","variable":"rain","comparator":">","value":0,"quantifier":"any","holds":true,"sampleCount":12,"matchCount":3,"firstMatch":{"time":1700003600,"value":0.4}},{"type":"group","operator":"any","holds":false,"children":[]}]}},"message":"Rain > 0 mm in B","push":{"attempted":2,"delivered":1,"failed":1}}"""
                "/api/config" -> HttpStatusCode.OK to """{"appName":"Weather alerts","appUrl":"http://localhost:3000","googleSignIn":false,"push":true,"pushChannels":{"fcm":true},"devMailbox":true}"""
                else -> HttpStatusCode.NotFound to "{}"
            }
        })
        val f = a.forecast(52.5, 13.4, "Europe/Berlin")
        assertEquals(4.5, f.hourlyValue("temperature_2m", 0)!!, 0.0)
        assertNull(f.hourlyValue("temperature_2m", 1))
        assertEquals(6.0, f.dailyValue("temperature_2m_max", 0)!!, 0.0)
        assertEquals("52.5", requests[0].url.parameters["latitude"])

        val t = a.testRule("r1")
        assertTrue(t.evaluation.matched)
        val cond = t.evaluation.root.children[0] as ConditionResult
        assertEquals(3, cond.matchCount)
        assertEquals(0.4, cond.firstMatch!!.value, 0.0)
        assertFalse((t.evaluation.root.children[1] as GroupResult).holds)
        assertEquals(PushCounts(2, 1, 1), t.push)

        val c = a.config()
        assertTrue(c.pushChannels.fcm)
        assertEquals("http://localhost:3000", c.appUrl)
        assertTrue(c.devMailbox)
    }
}
