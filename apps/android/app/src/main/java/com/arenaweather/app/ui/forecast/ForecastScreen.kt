package com.arenaweather.app.ui.forecast

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.arenaweather.app.AppContainer
import com.arenaweather.app.data.api.Forecast
import com.arenaweather.app.data.api.userMessage
import com.arenaweather.app.data.rules.Place
import com.arenaweather.app.data.weather.describeWeatherCode
import com.arenaweather.app.data.weather.formatCompass
import com.arenaweather.app.data.weather.formatDay
import com.arenaweather.app.data.weather.formatHour
import com.arenaweather.app.data.weather.formatNumber
import com.arenaweather.app.data.weather.formatTemp
import com.arenaweather.app.data.weather.upcomingHourIndices
import com.arenaweather.app.ui.components.ErrorCard
import com.arenaweather.app.ui.components.Loading
import com.arenaweather.app.ui.components.PlaceChip
import com.arenaweather.app.ui.components.PlaceSearchField
import com.arenaweather.app.ui.components.SectionTitle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ForecastUiState(
    val place: Place? = null,
    val forecast: Forecast? = null,
    val loading: Boolean = false,
    val error: String? = null,
    val locating: Boolean = false,
)

class ForecastViewModel(private val container: AppContainer) : ViewModel() {
    val state = MutableStateFlow(ForecastUiState())

    init {
        viewModelScope.launch {
            val last = container.settings.current().lastPlace
            if (last != null) show(last) else if (container.location.hasPermission()) useMyLocation()
        }
    }

    fun show(place: Place) {
        state.update { it.copy(place = place, loading = true, error = null) }
        viewModelScope.launch {
            container.settings.setLastPlace(place)
            runCatching { container.api.forecast(place.latitude, place.longitude, place.timezone) }
                .onSuccess { f -> state.update { it.copy(forecast = f, loading = false) } }
                .onFailure { e -> state.update { it.copy(loading = false, error = e.userMessage()) } }
        }
    }

    fun useMyLocation() {
        state.update { it.copy(locating = true, error = null) }
        viewModelScope.launch {
            val place = container.location.currentPlace()
            state.update { it.copy(locating = false) }
            if (place == null) state.update { it.copy(error = "Could not get the device location (is location on?)") }
            else show(place)
        }
    }

    fun retry() = state.value.place?.let { show(it) }
}

@Composable
fun ForecastScreen(container: AppContainer, vm: ForecastViewModel, onCreateRule: (Place) -> Unit, modifier: Modifier = Modifier) {
    val ui by vm.state.collectAsState()
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) vm.useMyLocation()
    }
    val requestLocation = {
        if (container.location.hasPermission()) vm.useMyLocation()
        else permission.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
    }

    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            PlaceSearchField(api = container.api, label = "Search a place", onPick = vm::show, onUseLocation = requestLocation)
        }
        val place = ui.place
        val f = ui.forecast
        if (place == null && !ui.loading && !ui.locating) {
            item {
                Column(Modifier.padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Pick a place to see its forecast", style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = requestLocation) { Text("Use my location") }
                }
            }
        }
        if (ui.locating) item { Text("Locating…", style = MaterialTheme.typography.bodyMedium) }
        if (ui.error != null) item { ErrorCard(ui.error!!, onRetry = vm::retry) }
        if (place != null) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    PlaceChip(place, Modifier.weight(1f))
                    Button(onClick = { onCreateRule(place) }) { Text("New rule here") }
                }
            }
        }
        if (ui.loading) item { Loading() }
        if (f != null && !ui.loading) {
            item { CurrentCard(f) }
            item { SectionTitle("Next 24 hours") }
            item { HourlyRow(f) }
            item { SectionTitle("7 days") }
            items(f.daily.time.indices.toList()) { i -> DailyRow(f, i) }
        }
    }
}

@Composable
private fun CurrentCard(f: Forecast) {
    val c = f.current ?: return
    val isDay = (c.values["is_day"] ?: 1.0) >= 0.5
    val w = describeWeatherCode(c.values["weather_code"], isDay)
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(w.icon, style = MaterialTheme.typography.displayMedium)
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(formatTemp(c.values["temperature_2m"]), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
                    Text("${w.text} · feels like ${formatTemp(c.values["apparent_temperature"])}", style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Stat("Humidity", formatNumber(c.values["relative_humidity_2m"], "%"))
                Stat("Wind", "${formatNumber(c.values["wind_speed_10m"], "km/h")} ${formatCompass(c.values["wind_direction_10m"])}")
                Stat("Gusts", formatNumber(c.values["wind_gusts_10m"], "km/h"))
                Stat("Clouds", formatNumber(c.values["cloud_cover"], "%"))
            }
            Text("Updated ${formatHour(c.time, f.timezone)}:00 (${f.timezone})", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleMedium)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun HourlyRow(f: Forecast) {
    val indices = remember(f) { f.upcomingHourIndices(24) }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(indices) { i ->
            val isDay = (f.hourlyValue("is_day", i) ?: 1.0) >= 0.5
            val w = describeWeatherCode(f.hourlyValue("weather_code", i), isDay)
            Card {
                Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(formatHour(f.hourly.time[i], f.timezone), style = MaterialTheme.typography.labelMedium)
                    Text(w.icon, style = MaterialTheme.typography.titleLarge)
                    Text(formatTemp(f.hourlyValue("temperature_2m", i)), style = MaterialTheme.typography.titleMedium)
                    Text("💧 ${formatNumber(f.hourlyValue("precipitation_probability", i), "%")}", style = MaterialTheme.typography.labelSmall)
                    Text("💨 ${formatNumber(f.hourlyValue("wind_speed_10m", i))}", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

@Composable
private fun DailyRow(f: Forecast, i: Int) {
    val w = describeWeatherCode(f.dailyValue("weather_code", i))
    Column {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(formatDay(f.daily.time[i], f.timezone), Modifier.width(96.dp), style = MaterialTheme.typography.bodyLarge)
            Text(w.icon, Modifier.width(36.dp), style = MaterialTheme.typography.titleLarge)
            Column(Modifier.weight(1f)) {
                Text(w.text, style = MaterialTheme.typography.bodyMedium)
                Text(
                    "💧 ${formatNumber(f.dailyValue("precipitation_probability_max", i), "%")} · ${formatNumber(f.dailyValue("precipitation_sum", i), "mm", 1)} · 💨 ${formatNumber(f.dailyValue("wind_speed_10m_max", i), "km/h")}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text("${formatTemp(f.dailyValue("temperature_2m_max", i))} / ${formatTemp(f.dailyValue("temperature_2m_min", i))}", style = MaterialTheme.typography.bodyLarge)
        }
        HorizontalDivider()
    }
}
