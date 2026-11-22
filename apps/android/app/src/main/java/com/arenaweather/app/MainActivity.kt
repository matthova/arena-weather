package com.arenaweather.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import com.arenaweather.app.data.push.AlertsMessagingService
import com.arenaweather.app.ui.AppRoot
import com.arenaweather.app.ui.theme.WeatherAlertsTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private var openRuleId by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as WeatherApp).container
        container.refreshConfig()
        lifecycleScope.launch { container.session.restore() }
        openRuleId = intent?.getStringExtra(AlertsMessagingService.EXTRA_RULE_ID)
        setContent {
            WeatherAlertsTheme {
                AppRoot(container = container, openRuleId = openRuleId, onRuleOpened = { openRuleId = null })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openRuleId = intent.getStringExtra(AlertsMessagingService.EXTRA_RULE_ID)
    }
}
