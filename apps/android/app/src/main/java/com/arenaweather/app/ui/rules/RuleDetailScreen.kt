package com.arenaweather.app.ui.rules

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.arenaweather.app.AppContainer
import com.arenaweather.app.data.rules.describe
import com.arenaweather.app.data.rules.summary
import com.arenaweather.app.data.weather.formatDateTime
import com.arenaweather.app.ui.components.ErrorCard
import com.arenaweather.app.ui.components.EvaluationTree
import com.arenaweather.app.ui.components.KeyValue
import com.arenaweather.app.ui.components.Loading
import com.arenaweather.app.ui.components.PlaceChip
import com.arenaweather.app.ui.components.SectionTitle

@Composable
fun RuleDetailScreen(container: AppContainer, vm: RulesViewModel, ruleId: String, onEdit: () -> Unit, onDeleted: () -> Unit, modifier: Modifier = Modifier) {
    val ui by vm.state.collectAsState()
    LaunchedEffect(ruleId) { if (!ui.loaded) vm.refresh() }
    val rule = ui.rules.firstOrNull { it.id == ruleId }
    var confirmDelete by rememberSaveable { mutableStateOf(false) }

    if (rule == null) {
        if (ui.loaded && !ui.loading) Column(modifier.padding(16.dp)) { ErrorCard(ui.error ?: "This rule no longer exists.") } else Loading(modifier)
        return
    }
    val busy = ruleId in ui.busy
    val test = ui.tests[ruleId]
    val testError = ui.testErrors[ruleId]

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(rule.name, Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            StatusChip(rule)
        }
        PlaceChip(rule.place)
        KeyValue("Window", rule.window.describe())
        KeyValue("Conditions", rule.root.summary(container.catalogue))
        if (rule.lastEvaluatedAt != null) KeyValue("Last checked", rule.lastEvaluatedAt.take(16).replace('T', ' ') + " UTC")
        if (rule.lastFiredAt != null) KeyValue("Last fired", rule.lastFiredAt.take(16).replace('T', ' ') + " UTC")
        if (ui.error != null) ErrorCard(ui.error!!) 

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { vm.test(ruleId) }, enabled = !busy) { Text(if (busy) "Working…" else "Test this rule now") }
            OutlinedButton(onClick = onEdit, enabled = !busy) { Text("Edit") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { vm.setPaused(ruleId, !rule.paused) }, enabled = !busy) { Text(if (rule.paused) "Resume" else "Pause") }
            TextButton(onClick = { confirmDelete = true }, enabled = !busy) { Text("Delete", color = MaterialTheme.colorScheme.error) }
        }

        if (testError != null) ErrorCard(testError)
        if (test != null) {
            SectionTitle(if (test.evaluation.matched) "Result: the rule holds right now" else "Result: the rule does not hold right now")
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Evaluated ${formatDateTime(test.evaluation.evaluatedAt, rule.place.timezone ?: java.util.TimeZone.getDefault().id)}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    EvaluationTree(test.evaluation.root, rule.place.timezone ?: java.util.TimeZone.getDefault().id, container.catalogue)
                    KeyValue("Notification text", test.message)
                    KeyValue("Push", "${test.push.delivered} of ${test.push.attempted} device${if (test.push.attempted == 1) "" else "s"} reached" + if (test.push.failed > 0) ", ${test.push.failed} failed" else "")
                    if (test.push.attempted == 0) Text("No device is registered for push: see the Alerts tab.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete this rule?") },
            text = { Text("“${rule.name}” will stop being checked. This cannot be undone.") },
            confirmButton = { TextButton(onClick = { confirmDelete = false; vm.delete(ruleId, onDeleted) }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}
