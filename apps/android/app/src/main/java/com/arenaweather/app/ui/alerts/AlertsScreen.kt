package com.arenaweather.app.ui.alerts

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.arenaweather.app.AppContainer
import com.arenaweather.app.data.AuthState
import com.arenaweather.app.data.api.RegisteredDevice
import com.arenaweather.app.data.api.userMessage
import com.arenaweather.app.data.push.AlertsMessagingService
import com.arenaweather.app.ui.components.ErrorCard
import com.arenaweather.app.ui.components.KeyValue
import com.arenaweather.app.ui.components.SectionTitle
import kotlinx.coroutines.launch

/** Push on this device (permission, Firebase, API registration), the account's devices, and the account itself. */
@Composable
fun AlertsScreen(container: AppContainer, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val push by container.push.status.collectAsState()
    val auth by container.session.state.collectAsState()
    val config by container.config.collectAsState()
    var devices by remember { mutableStateOf<List<RegisteredDevice>?>(null) }
    var devicesError by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }

    fun notificationsAllowed(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    var allowed by remember { mutableStateOf(notificationsAllowed()) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed = it }

    fun loadDevices() {
        scope.launch {
            runCatching { container.api.listDevices().subscriptions }
                .onSuccess { devices = it; devicesError = null }
                .onFailure { devicesError = it.userMessage() }
        }
    }
    LaunchedEffect(Unit) {
        loadDevices()
        container.push.syncIfNeeded()
    }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Alerts on this device", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Step(1, "Notification permission", if (allowed) "granted" else "not granted", ok = allowed)
                if (!allowed && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    Button(onClick = { permission.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Allow notifications") }
                }
                Step(2, "Firebase in this build", if (push.firebaseConfigured) "configured" else "missing google-services.json", ok = push.firebaseConfigured)
                if (!push.firebaseConfigured) Text("Add apps/android/app/google-services.json from your Firebase project and rebuild (README). Everything else works without it; only delivery is missing.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Step(3, "Device registered with the API", if (push.registered) "yes" else if (push.token == null) "no token yet" else "not yet", ok = push.registered)
                val server = push.serverCanDeliver ?: config?.pushChannels?.fcm
                Step(4, "Server can send to Android (FCM_SERVICE_ACCOUNT)", when (server) { true -> "yes"; false -> "not configured"; null -> "unknown" }, ok = server == true)
                if (push.lastError != null) Text(push.lastError!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                if (note != null) Text(note!!, style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = push.firebaseConfigured && !busy,
                        onClick = {
                            busy = true
                            note = null
                            scope.launch {
                                runCatching { container.push.syncIfNeeded(force = true) }
                                    .onSuccess { note = "Registered."; loadDevices() }
                                    .onFailure { note = it.userMessage() }
                                busy = false
                            }
                        },
                    ) { Text(if (push.registered) "Re-register this device" else "Register this device") }
                    OutlinedButton(onClick = {
                        AlertsMessagingService.showNotification(context, "Weather alerts", "This is what an alert looks like on this device.", ruleId = null, tag = "local-test")
                    }, enabled = allowed) { Text("Preview a notification") }
                }
                if (push.token != null) Text("Token …${push.token!!.takeLast(12)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        SectionTitle("Devices on this account")
        Text("Every rule notifies all of them (web browsers and phones alike).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (devicesError != null) ErrorCard(devicesError!!, onRetry = ::loadDevices)
        val list = devices
        if (list != null) {
            if (list.isEmpty()) Text("None yet.")
            list.forEach { d ->
                Column(Modifier.padding(vertical = 6.dp)) {
                    Text(
                        when (d.channel) {
                            "fcm" -> "Android (FCM)" + if (d.endpoint == push.token) " · this device" else ""
                            "apns" -> "iPhone / Mac (APNs)"
                            else -> "Browser (web push)"
                        },
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Text(listOfNotNull(d.userAgent, d.createdAt.take(10)).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HorizontalDivider()
            }
        }

        SectionTitle("Account")
        val user = (auth as? AuthState.SignedIn)?.user
        if (user != null) {
            KeyValue("Signed in as", listOf(user.name, user.email).filter { it.isNotBlank() }.joinToString(" · "))
        }
        KeyValue("Server", container.baseUrl)
        TextButton(onClick = { scope.launch { container.session.signOut() } }) { Text("Sign out", color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
private fun Step(n: Int, title: String, status: String, ok: Boolean) {
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Text(if (ok) "✅" else "⬜", Modifier.padding(end = 8.dp))
        Column {
            Text("$n. $title", style = MaterialTheme.typography.bodyMedium)
            Text(status, style = MaterialTheme.typography.bodySmall, color = if (ok) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
