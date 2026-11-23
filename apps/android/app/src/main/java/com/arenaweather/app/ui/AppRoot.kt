package com.arenaweather.app.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.automirrored.filled.Rule
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.arenaweather.app.AppContainer
import com.arenaweather.app.data.AuthState
import com.arenaweather.app.data.rules.Place
import com.arenaweather.app.ui.alerts.AlertsScreen
import com.arenaweather.app.ui.auth.CheckEmailScreen
import com.arenaweather.app.ui.auth.SignInScreen
import com.arenaweather.app.ui.auth.SignUpScreen
import com.arenaweather.app.ui.components.Loading
import com.arenaweather.app.ui.forecast.ForecastScreen
import com.arenaweather.app.ui.forecast.ForecastViewModel
import com.arenaweather.app.ui.rules.RuleDetailScreen
import com.arenaweather.app.ui.rules.RuleEditorScreen
import com.arenaweather.app.ui.rules.RulesScreen
import com.arenaweather.app.ui.rules.RulesViewModel
import java.net.URLDecoder
import java.net.URLEncoder

object Routes {
    const val FORECAST = "forecast"
    const val RULES = "rules"
    const val ALERTS = "alerts"
    const val SIGN_UP = "sign-up"
    const val CHECK_EMAIL = "check-email/{email}"
    const val RULE_NEW = "rules/new?lat={lat}&lon={lon}&label={label}&tz={tz}"
    const val RULE_DETAIL = "rules/{id}"
    const val RULE_EDIT = "rules/{id}/edit"

    fun checkEmail(email: String) = "check-email/${enc(email)}"
    fun ruleDetail(id: String) = "rules/$id"
    fun ruleEdit(id: String) = "rules/$id/edit"
    fun ruleNew(place: Place?): String =
        if (place == null) "rules/new" else "rules/new?lat=${place.latitude}&lon=${place.longitude}&label=${enc(place.label)}&tz=${enc(place.timezone ?: "")}"

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab(Routes.FORECAST, "Forecast", Icons.Default.Cloud),
    Tab(Routes.RULES, "Rules", Icons.AutoMirrored.Filled.Rule),
    Tab(Routes.ALERTS, "Alerts", Icons.Default.Notifications),
)

@Suppress("UNCHECKED_CAST")
private class Factory(val container: AppContainer) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when {
        modelClass.isAssignableFrom(RulesViewModel::class.java) -> RulesViewModel(container) as T
        modelClass.isAssignableFrom(ForecastViewModel::class.java) -> ForecastViewModel(container) as T
        else -> error("Unknown ViewModel $modelClass")
    }
}

@Composable
fun AppRoot(container: AppContainer, openRuleId: String?, onRuleOpened: () -> Unit) {
    val nav = rememberNavController()
    val factory = Factory(container)
    val rulesVm: RulesViewModel = viewModel(factory = factory)
    val forecastVm: ForecastViewModel = viewModel(factory = factory)
    val auth by container.session.state.collectAsState()
    val backStack by nav.currentBackStackEntryAsState()
    val currentRoute = backStack?.destination?.route

    // A tapped notification opens its rule
    LaunchedEffect(openRuleId, auth) {
        if (openRuleId != null && auth is AuthState.SignedIn) {
            nav.navigate(Routes.ruleDetail(openRuleId))
            onRuleOpened()
        }
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                tabs.forEach { tab ->
                    val selected = currentRoute == tab.route || (tab.route == Routes.RULES && currentRoute?.startsWith("rules") == true)
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            nav.navigate(tab.route) {
                                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(tab.icon, null) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        val m = Modifier.fillMaxSize().padding(padding)
        NavHost(nav, startDestination = Routes.FORECAST, modifier = m) {
            composable(Routes.FORECAST) {
                ForecastScreen(container, forecastVm, onCreateRule = { place -> nav.navigate(Routes.ruleNew(place)) })
            }
            composable(Routes.RULES) {
                RequireAuth(container, nav, auth) {
                    RulesScreen(container, rulesVm, onOpen = { nav.navigate(Routes.ruleDetail(it)) }, onCreate = { nav.navigate(Routes.ruleNew(forecastVm.state.value.place)) })
                }
            }
            composable(
                Routes.RULE_NEW,
                arguments = listOf(
                    navArgument("lat") { type = NavType.StringType; nullable = true },
                    navArgument("lon") { type = NavType.StringType; nullable = true },
                    navArgument("label") { type = NavType.StringType; nullable = true },
                    navArgument("tz") { type = NavType.StringType; nullable = true },
                ),
            ) { entry ->
                val lat = entry.arguments?.getString("lat")?.toDoubleOrNull()
                val lon = entry.arguments?.getString("lon")?.toDoubleOrNull()
                val label = entry.arguments?.getString("label")?.let { URLDecoder.decode(it, "UTF-8") }
                val tz = entry.arguments?.getString("tz")?.let { URLDecoder.decode(it, "UTF-8") }?.ifBlank { null }
                val place = if (lat != null && lon != null && label != null) Place(label, lat, lon, tz) else null
                RequireAuth(container, nav, auth) {
                    RuleEditorScreen(container, rulesVm, ruleId = null, initialPlace = place, onSaved = { id ->
                        nav.navigate(Routes.ruleDetail(id)) { popUpTo(Routes.RULES) }
                    }, onCancel = { nav.popBackStack() })
                }
            }
            composable(Routes.RULE_DETAIL, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
                val id = entry.arguments?.getString("id") ?: return@composable
                RequireAuth(container, nav, auth) {
                    RuleDetailScreen(container, rulesVm, id, onEdit = { nav.navigate(Routes.ruleEdit(id)) }, onDeleted = { nav.popBackStack(Routes.RULES, inclusive = false) })
                }
            }
            composable(Routes.RULE_EDIT, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
                val id = entry.arguments?.getString("id") ?: return@composable
                RequireAuth(container, nav, auth) {
                    RuleEditorScreen(container, rulesVm, ruleId = id, initialPlace = null, onSaved = { nav.popBackStack() }, onCancel = { nav.popBackStack() })
                }
            }
            composable(Routes.ALERTS) {
                RequireAuth(container, nav, auth) { AlertsScreen(container) }
            }
            composable(Routes.SIGN_UP) {
                SignUpScreen(container, onDone = { email -> nav.navigate(Routes.checkEmail(email)) { popUpTo(Routes.SIGN_UP) { inclusive = true } } }, onBack = { nav.popBackStack() })
            }
            composable(Routes.CHECK_EMAIL, arguments = listOf(navArgument("email") { type = NavType.StringType })) { entry ->
                val email = URLDecoder.decode(entry.arguments?.getString("email") ?: "", "UTF-8")
                CheckEmailScreen(container, email, onSignIn = { nav.popBackStack(Routes.FORECAST, inclusive = false); nav.navigate(Routes.RULES) })
            }
        }
    }
}

/** Shows the sign-in form in place of a protected screen until there is a session. */
@Composable
private fun RequireAuth(container: AppContainer, nav: NavHostController, auth: AuthState, content: @Composable () -> Unit) {
    when (auth) {
        AuthState.Loading -> Loading()
        AuthState.SignedOut -> SignInScreen(
            container,
            onSignUp = { nav.navigate(Routes.SIGN_UP) },
            onNeedsVerification = { email -> nav.navigate(Routes.checkEmail(email)) },
        )
        is AuthState.SignedIn -> content()
    }
}
