package com.arenaweather.app.ui.rules

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.arenaweather.app.AppContainer
import com.arenaweather.app.data.api.ApiException
import com.arenaweather.app.data.api.RuleTestResponse
import com.arenaweather.app.data.api.userMessage
import com.arenaweather.app.data.rules.Rule
import com.arenaweather.app.data.rules.RuleDefinition
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RulesUiState(
    val rules: List<Rule> = emptyList(),
    val loaded: Boolean = false,
    val loading: Boolean = false,
    val error: String? = null,
    /** Rule ids with a request in flight (pause/resume/delete/test). */
    val busy: Set<String> = emptySet(),
    /** Last "test this rule now" result per rule id. */
    val tests: Map<String, RuleTestResponse> = emptyMap(),
    val testErrors: Map<String, String> = emptyMap(),
)

/** The rules list and every action on a rule; one instance shared by the list, detail and editor screens. */
class RulesViewModel(private val container: AppContainer) : ViewModel() {
    val state = MutableStateFlow(RulesUiState())

    fun refresh() {
        state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val rules = container.api.listRules().rules
                state.update { it.copy(rules = rules, loaded = true, loading = false) }
            } catch (e: Exception) {
                if (e is ApiException && e.isUnauthorized) container.session.expired()
                state.update { it.copy(loading = false, loaded = true, error = e.userMessage()) }
            }
        }
    }

    fun rule(id: String): Rule? = state.value.rules.firstOrNull { it.id == id }

    private fun replace(rule: Rule) = state.update { s -> s.copy(rules = s.rules.map { if (it.id == rule.id) rule else it }) }

    private fun withBusy(id: String, block: suspend () -> Unit) {
        state.update { it.copy(busy = it.busy + id) }
        viewModelScope.launch {
            try {
                block()
            } catch (e: Exception) {
                if (e is ApiException && e.isUnauthorized) container.session.expired()
                state.update { it.copy(error = e.userMessage()) }
            } finally {
                state.update { it.copy(busy = it.busy - id) }
            }
        }
    }

    fun setPaused(id: String, paused: Boolean) = withBusy(id) {
        replace(if (paused) container.api.pauseRule(id).rule else container.api.resumeRule(id).rule)
    }

    fun delete(id: String, onDone: () -> Unit = {}) = withBusy(id) {
        container.api.deleteRule(id)
        state.update { s -> s.copy(rules = s.rules.filterNot { it.id == id }, tests = s.tests - id) }
        onDone()
    }

    fun test(id: String) {
        state.update { it.copy(testErrors = it.testErrors - id) }
        withBusy(id) {
            try {
                val r = container.api.testRule(id)
                state.update { it.copy(tests = it.tests + (id to r)) }
                replace(r.rule)
            } catch (e: Exception) {
                state.update { it.copy(testErrors = it.testErrors + (id to e.userMessage())) }
            }
        }
    }

    /** Create or update; returns the saved rule or throws. */
    suspend fun save(id: String?, definition: RuleDefinition): Rule {
        val saved = if (id == null) container.api.createRule(definition).rule else container.api.updateRule(id, definition).rule
        state.update { s -> if (id == null) s.copy(rules = listOf(saved) + s.rules) else s.copy(rules = s.rules.map { if (it.id == saved.id) saved else it }) }
        return saved
    }

    fun clearError() = state.update { it.copy(error = null) }
}
