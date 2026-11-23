package com.arenaweather.app.ui.rules

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.arenaweather.app.AppContainer
import com.arenaweather.app.data.rules.Rule
import com.arenaweather.app.data.rules.describe
import com.arenaweather.app.data.rules.summary
import com.arenaweather.app.ui.components.ErrorCard
import com.arenaweather.app.ui.components.Loading

@Composable
fun RulesScreen(container: AppContainer, vm: RulesViewModel, onOpen: (String) -> Unit, onCreate: () -> Unit, modifier: Modifier = Modifier) {
    val ui by vm.state.collectAsState()
    LaunchedEffect(Unit) { if (!ui.loaded) vm.refresh() }

    Scaffold(
        modifier = modifier,
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = onCreate, icon = { Icon(Icons.Default.Add, null) }, text = { Text("New rule") })
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text("Your rules", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Checked every 15 minutes; each rule notifies once when it becomes true and re-arms when it is false again.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (ui.error != null) item { ErrorCard(ui.error!!, onRetry = { vm.clearError(); vm.refresh() }) }
            if (ui.loading && ui.rules.isEmpty()) item { Loading() }
            if (ui.loaded && !ui.loading && ui.rules.isEmpty() && ui.error == null) {
                item {
                    Column(Modifier.fillMaxWidth().padding(top = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("No rules yet.", style = MaterialTheme.typography.bodyLarge)
                        Button(onClick = onCreate, Modifier.padding(top = 12.dp)) { Text("Create your first rule") }
                    }
                }
            }
            items(ui.rules, key = { it.id }) { rule ->
                RuleCard(rule, container, busy = rule.id in ui.busy, onOpen = { onOpen(rule.id) }, onPause = { vm.setPaused(rule.id, !rule.paused) }, onTest = { vm.test(rule.id) })
            }
        }
    }
}

@Composable
private fun RuleCard(rule: Rule, container: AppContainer, busy: Boolean, onOpen: () -> Unit, onPause: () -> Unit, onTest: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(rule.name, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                StatusChip(rule)
            }
            Text(rule.place.label + " · " + rule.window.describe(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(rule.root.summary(container.catalogue), style = MaterialTheme.typography.bodyMedium)
            if (rule.lastFiredAt != null) Text("Last fired ${rule.lastFiredAt.take(16).replace('T', ' ')}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onPause, enabled = !busy) { Text(if (rule.paused) "Resume" else "Pause") }
                TextButton(onClick = { onTest(); onOpen() }, enabled = !busy) { Text("Test now") }
            }
        }
    }
}

@Composable
fun StatusChip(rule: Rule) {
    val (label, color) = when {
        rule.paused -> "Paused" to MaterialTheme.colorScheme.outline
        !rule.armed -> "Fired, waiting to re-arm" to MaterialTheme.colorScheme.tertiary
        else -> "Armed" to MaterialTheme.colorScheme.primary
    }
    AssistChip(onClick = {}, enabled = false, label = { Text(label, color = color) })
}
