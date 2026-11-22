package com.arenaweather.app

import android.app.Application
import com.arenaweather.app.data.push.AlertsMessagingService

class WeatherApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        // The API addresses this channel by id (android.notification.channel_id in the FCM message);
        // it must exist before the first background message arrives.
        AlertsMessagingService.ensureChannel(this)
    }
}
