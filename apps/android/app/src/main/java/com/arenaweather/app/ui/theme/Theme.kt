package com.arenaweather.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val Sky = Color(0xFF1565C0)
private val SkyDark = Color(0xFF90CAF9)
private val Rain = Color(0xFF00897B)
private val Storm = Color(0xFF6A1B9A)

private val LightColors = lightColorScheme(primary = Sky, secondary = Rain, tertiary = Storm)
private val DarkColors = darkColorScheme(primary = SkyDark, secondary = Color(0xFF80CBC4), tertiary = Color(0xFFCE93D8))

@Composable
fun WeatherAlertsTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val context = LocalContext.current
    val colors = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        darkTheme -> DarkColors
        else -> LightColors
    }
    MaterialTheme(colorScheme = colors, content = content)
}
