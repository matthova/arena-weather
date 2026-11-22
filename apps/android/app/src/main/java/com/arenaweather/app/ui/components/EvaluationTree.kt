package com.arenaweather.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.arenaweather.app.data.api.ConditionResult
import com.arenaweather.app.data.api.GroupResult
import com.arenaweather.app.data.api.NodeResult
import com.arenaweather.app.data.rules.GroupOperator
import com.arenaweather.app.data.rules.Quantifier
import com.arenaweather.app.data.rules.VariableCatalogue
import com.arenaweather.app.data.rules.describeCondition
import com.arenaweather.app.data.weather.formatDateTime

/** The evaluation `POST /api/rules/:id/test` returns, node by node, same explanations as the web app. */
@Composable
fun EvaluationTree(node: NodeResult, timeZone: String, catalogue: VariableCatalogue, modifier: Modifier = Modifier, depth: Int = 0) {
    Column(modifier.padding(start = (depth * 16).dp)) {
        when (node) {
            is GroupResult -> {
                HoldsRow(node.holds, if (node.operator == GroupOperator.ALL) "All of" else "Any of", bold = true)
                node.children.forEach { EvaluationTree(it, timeZone, catalogue, depth = depth + 1) }
            }
            is ConditionResult -> {
                val text = describeCondition(node.variable, node.granularity, node.comparator, node.value, catalogue) +
                    if (node.quantifier == Quantifier.ALL) " (every sample)" else ""
                HoldsRow(node.holds, text)
                val detail = when {
                    node.missingVariable -> "forecast has no data for this variable"
                    node.sampleCount == 0 -> "no samples in the window"
                    node.firstMatch != null -> "${node.matchCount}/${node.sampleCount} samples match; first at ${formatDateTime(node.firstMatch.time, timeZone)} (${trim(node.firstMatch.value)})"
                    else -> "0/${node.sampleCount} samples match"
                }
                Text(detail, Modifier.padding(start = 32.dp, bottom = 6.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

private fun trim(v: Double): String = if (v == Math.floor(v)) v.toLong().toString() else "%.1f".format(v)

@Composable
private fun HoldsRow(holds: Boolean, text: String, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(
            if (holds) Icons.Default.CheckCircle else Icons.Default.Cancel,
            contentDescription = if (holds) "holds" else "does not hold",
            tint = if (holds) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
        )
        Text(text, Modifier.padding(start = 8.dp), style = MaterialTheme.typography.bodyMedium, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal)
    }
}
