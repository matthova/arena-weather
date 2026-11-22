package com.arenaweather.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.arenaweather.app.data.api.PlaceSearchResult
import com.arenaweather.app.data.api.WeatherApi
import com.arenaweather.app.data.api.userMessage
import com.arenaweather.app.data.rules.Place
import kotlinx.coroutines.delay

fun PlaceSearchResult.toPlace(): Place = Place(label = label, latitude = latitude, longitude = longitude, timezone = timezone)

/**
 * A search box over `GET /api/places/search` (debounced) with a result list; `onUseLocation`
 * adds a "my location" button. Used by the forecast screen and the rule editor.
 */
@Composable
fun PlaceSearchField(
    api: WeatherApi,
    label: String,
    onPick: (Place) -> Unit,
    modifier: Modifier = Modifier,
    initialText: String = "",
    onUseLocation: (() -> Unit)? = null,
) {
    var text by rememberSaveable { mutableStateOf(initialText) }
    var results by remember { mutableStateOf<List<PlaceSearchResult>>(emptyList()) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var searching by rememberSaveable { mutableStateOf(false) }
    var dirty by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(text, dirty) {
        if (!dirty) return@LaunchedEffect
        val q = text.trim()
        if (q.length < 2) {
            results = emptyList()
            return@LaunchedEffect
        }
        delay(300)
        searching = true
        error = null
        runCatching { api.searchPlaces(q).results }
            .onSuccess { results = it }
            .onFailure { error = it.userMessage() }
        searching = false
    }

    Column(modifier) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it; dirty = true },
            label = { Text(label) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            trailingIcon = {
                Row {
                    if (text.isNotEmpty()) IconButton(onClick = { text = ""; results = emptyList(); dirty = true }) { Icon(Icons.Default.Clear, "Clear") }
                    if (onUseLocation != null) IconButton(onClick = onUseLocation) { Icon(Icons.Default.MyLocation, "Use my location") }
                }
            },
            supportingText = {
                when {
                    error != null -> Text(error!!, color = MaterialTheme.colorScheme.error)
                    searching -> Text("Searching…")
                }
            },
        )
        if (results.isNotEmpty()) {
            Card(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                results.forEachIndexed { i, r ->
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                onPick(r.toPlace())
                                text = r.label
                                results = emptyList()
                                dirty = false
                            }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                    ) {
                        Text(r.name, style = MaterialTheme.typography.bodyLarge)
                        Text(r.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (i < results.lastIndex) HorizontalDivider()
                }
            }
        }
    }
}

@Composable
fun PlaceChip(place: Place, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Default.MyLocation, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Column(Modifier.padding(start = 8.dp)) {
            Text(place.label, style = MaterialTheme.typography.bodyLarge)
            Text(
                "%.3f, %.3f%s".format(place.latitude, place.longitude, place.timezone?.let { " · $it" } ?: ""),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
