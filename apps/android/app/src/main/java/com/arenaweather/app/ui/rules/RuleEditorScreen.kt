package com.arenaweather.app.ui.rules

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.arenaweather.app.AppContainer
import com.arenaweather.app.data.api.userMessage
import com.arenaweather.app.data.rules.Comparator
import com.arenaweather.app.data.rules.ConditionDraft
import com.arenaweather.app.data.rules.DraftErrors
import com.arenaweather.app.data.rules.DraftResult
import com.arenaweather.app.data.rules.Granularity
import com.arenaweather.app.data.rules.GroupDraft
import com.arenaweather.app.data.rules.GroupOperator
import com.arenaweather.app.data.rules.MAX_GROUP_DEPTH
import com.arenaweather.app.data.rules.NodeDraft
import com.arenaweather.app.data.rules.Place
import com.arenaweather.app.data.rules.Quantifier
import com.arenaweather.app.data.rules.RuleDraft
import com.arenaweather.app.data.rules.VariableCatalogue
import com.arenaweather.app.data.rules.addChild
import com.arenaweather.app.data.rules.removeNode
import com.arenaweather.app.data.rules.toDefinition
import com.arenaweather.app.data.rules.toDraft
import com.arenaweather.app.data.rules.updateCondition
import com.arenaweather.app.data.rules.updateGroup
import com.arenaweather.app.ui.components.ErrorCard
import com.arenaweather.app.ui.components.Loading
import com.arenaweather.app.ui.components.PlaceChip
import com.arenaweather.app.ui.components.PlaceSearchField
import com.arenaweather.app.ui.components.SectionTitle
import kotlinx.coroutines.launch

/**
 * The rule builder: name, place, optional window, and the nested all/any tree of conditions.
 * State is a [RuleDraft]; saving runs [toDefinition] (same checks as the server) and then
 * `POST`/`PUT /api/rules`.
 */
@Composable
fun RuleEditorScreen(
    container: AppContainer,
    vm: RulesViewModel,
    ruleId: String?,
    initialPlace: Place?,
    onSaved: (String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui by vm.state.collectAsState()
    LaunchedEffect(ruleId) { if (ruleId != null && !ui.loaded) vm.refresh() }
    val existing = ruleId?.let { id -> ui.rules.firstOrNull { it.id == id } }
    if (ruleId != null && existing == null) {
        if (ui.loaded && !ui.loading) Column(modifier.padding(16.dp)) { ErrorCard(ui.error ?: "This rule no longer exists.") } else Loading(modifier)
        return
    }
    var draft by remember(existing?.id) { mutableStateOf(existing?.definition()?.toDraft() ?: RuleDraft(place = initialPlace)) }
    RuleEditor(container, draft, onChange = { draft = it }, ruleId = ruleId, onSave = { def -> vm.save(ruleId, def).id }, onSaved = onSaved, onCancel = onCancel, modifier = modifier)
}

@Composable
fun RuleEditor(
    container: AppContainer,
    draft: RuleDraft,
    onChange: (RuleDraft) -> Unit,
    ruleId: String?,
    onSave: suspend (com.arenaweather.app.data.rules.RuleDefinition) -> String,
    onSaved: (String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val catalogue = container.catalogue
    var errors by remember { mutableStateOf(DraftErrors()) }
    var serverError by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var locating by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) scope.launch { locating = true; container.location.currentPlace()?.let { onChange(draft.copy(place = it)) }; locating = false }
    }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(if (ruleId == null) "New rule" else "Edit rule", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)

        OutlinedTextField(draft.name, { onChange(draft.copy(name = it)) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())

        SectionTitle("Place")
        if (draft.place != null) PlaceChip(draft.place)
        PlaceSearchField(
            api = container.api,
            label = if (draft.place == null) "Search a place" else "Change the place",
            onPick = { onChange(draft.copy(place = it)) },
            onUseLocation = {
                if (container.location.hasPermission()) scope.launch { locating = true; container.location.currentPlace()?.let { onChange(draft.copy(place = it)) }; locating = false }
                else permission.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
            },
        )
        if (locating) Text("Locating…", style = MaterialTheme.typography.bodySmall)

        SectionTitle("When to look")
        Text("Leave empty for the next 24 hours (hourly conditions) and the next 7 days (daily conditions).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(draft.window.hoursAhead, { onChange(draft.copy(window = draft.window.copy(hoursAhead = it))) }, label = { Text("Hours ahead (1–168)") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            OutlinedTextField(draft.window.daysAhead, { onChange(draft.copy(window = draft.window.copy(daysAhead = it))) }, label = { Text("Days ahead (1–7)") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(draft.window.useHoursOfDay, { onChange(draft.copy(window = draft.window.copy(useHoursOfDay = it))) })
            Text("Only certain hours of the day")
        }
        if (draft.window.useHoursOfDay) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(draft.window.hoursFrom, { onChange(draft.copy(window = draft.window.copy(hoursFrom = it))) }, label = { Text("From hour (0–23)") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                OutlinedTextField(draft.window.hoursTo, { onChange(draft.copy(window = draft.window.copy(hoursTo = it))) }, label = { Text("To hour (0–23)") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            }
            Text("From > to wraps past midnight (22 to 6 = night).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        SectionTitle("Conditions")
        GroupEditor(
            group = draft.root,
            depth = 1,
            isRoot = true,
            catalogue = catalogue,
            errors = errors,
            onChange = { onChange(draft.copy(root = it)) },
            root = draft.root,
        )

        if (errors.messages.isNotEmpty()) ErrorCard(errors.messages.joinToString("\n"))
        if (serverError != null) ErrorCard(serverError!!)

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            Button(
                enabled = !saving,
                onClick = {
                    serverError = null
                    when (val r = draft.toDefinition(catalogue)) {
                        is DraftResult.Invalid -> errors = r.errors
                        is DraftResult.Ok -> {
                            errors = DraftErrors()
                            saving = true
                            scope.launch {
                                try {
                                    onSaved(onSave(r.definition))
                                } catch (e: Exception) {
                                    serverError = e.userMessage()
                                } finally {
                                    saving = false
                                }
                            }
                        }
                    }
                },
            ) { Text(if (saving) "Saving…" else if (ruleId == null) "Create rule" else "Save changes") }
            TextButton(onClick = onCancel, enabled = !saving) { Text("Cancel") }
        }
        Spacer(Modifier.height(32.dp))
    }
}

@Composable
private fun GroupEditor(
    group: GroupDraft,
    depth: Int,
    isRoot: Boolean,
    catalogue: VariableCatalogue,
    errors: DraftErrors,
    onChange: (GroupDraft) -> Unit,
    root: GroupDraft,
) {
    val error = errors.nodes[group.key]
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = if (depth % 2 == 1) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.surfaceContainerHigh),
        border = if (error != null) BorderStroke(1.dp, MaterialTheme.colorScheme.error) else null,
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                    GroupOperator.entries.forEachIndexed { i, op ->
                        SegmentedButton(
                            selected = group.operator == op,
                            onClick = { onChange(root.updateGroup(group.key) { it.copy(operator = op) }) },
                            shape = SegmentedButtonDefaults.itemShape(i, GroupOperator.entries.size),
                        ) { Text(if (op == GroupOperator.ALL) "All of (and)" else "Any of (or)") }
                    }
                }
                if (!isRoot) IconButton(onClick = { onChange(root.removeNode(group.key)) }) { Icon(Icons.Default.Delete, "Remove group") }
            }
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)

            group.children.forEach { child ->
                when (child) {
                    is ConditionDraft -> ConditionEditor(child, catalogue, errors.nodes[child.key], onChange = { c -> onChange(root.updateCondition(child.key) { c }) }, onRemove = { onChange(root.removeNode(child.key)) })
                    is GroupDraft -> GroupEditor(child, depth + 1, false, catalogue, errors, onChange, root)
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { onChange(root.addChild(group.key, ConditionDraft())) }) { Text("+ Condition") }
                if (depth < MAX_GROUP_DEPTH) OutlinedButton(onClick = { onChange(root.addChild(group.key, GroupDraft(operator = if (group.operator == GroupOperator.ALL) GroupOperator.ANY else GroupOperator.ALL))) }) { Text("+ Group") }
            }
        }
    }
}

@Composable
private fun ConditionEditor(c: ConditionDraft, catalogue: VariableCatalogue, error: String?, onChange: (ConditionDraft) -> Unit, onRemove: () -> Unit) {
    Card(Modifier.fillMaxWidth(), border = if (error != null) BorderStroke(1.dp, MaterialTheme.colorScheme.error) else null) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Granularity.entries.forEach { g ->
                    FilterChip(
                        selected = c.granularity == g,
                        onClick = {
                            if (c.granularity != g) {
                                val first = catalogue.forGranularity(g).firstOrNull()?.name ?: c.variable
                                onChange(c.copy(granularity = g, variable = first))
                            }
                        },
                        label = { Text(if (g == Granularity.HOURLY) "Hourly" else "Daily") },
                    )
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onRemove) { Icon(Icons.Default.Delete, "Remove condition") }
            }
            val variables = catalogue.forGranularity(c.granularity)
            val selected = variables.firstOrNull { it.name == c.variable }
            Dropdown(label = "Variable", value = selected?.let { "${it.label} (${it.unit})" } ?: c.variable, options = variables.map { "${it.label} (${it.unit})" }) { i -> onChange(c.copy(variable = variables[i].name)) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Dropdown(label = "Is", value = c.comparator.symbol, options = Comparator.entries.map { it.symbol }, modifier = Modifier.width(110.dp)) { i -> onChange(c.copy(comparator = Comparator.entries[i])) }
                OutlinedTextField(
                    c.value,
                    { onChange(c.copy(value = it)) },
                    label = { Text("Value" + (selected?.unit?.let { " ($it)" } ?: "")) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    isError = error != null,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("For", style = MaterialTheme.typography.bodyMedium)
                Quantifier.entries.forEach { q ->
                    FilterChip(selected = c.quantifier == q, onClick = { onChange(c.copy(quantifier = q)) }, label = { Text(if (q == Quantifier.ANY) "any sample" else "every sample") })
                }
            }
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun Dropdown(label: String, value: String, options: List<String>, modifier: Modifier = Modifier, onPick: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(modifier) {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.labelSmall)
                Text(value, maxLines = 1)
            }
            Icon(Icons.Default.ArrowDropDown, null)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEachIndexed { i, o -> DropdownMenuItem(text = { Text(o) }, onClick = { open = false; onPick(i) }) }
        }
    }
}
