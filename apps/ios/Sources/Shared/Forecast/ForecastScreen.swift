import SwiftUI
import WeatherAlertsKit

/// Current conditions, the next 24 hours and 7 days for a place. The last place is remembered.
struct ForecastScreen: View {
    @Environment(AppModel.self) private var model
    @State private var place: Place?
    @State private var forecast: Forecast?
    @State private var loading = false
    @State private var error: String?
    @State private var choosing = false
    @State private var location = LocationService()

    var body: some View {
        NavigationStack {
            Group {
                if let place, let forecast {
                    ForecastView(place: place, forecast: forecast)
                } else if loading {
                    ProgressView("Loading forecast…")
                } else if place == nil {
                    ContentUnavailableView {
                        Label("Pick a place", systemImage: "mappin.and.ellipse")
                    } description: {
                        Text("Search a city or use your location to see the forecast.")
                    } actions: {
                        Button("Use my location") { Task { await useLocation() } }.buttonStyle(.borderedProminent)
                        Button("Search a place") { choosing = true }
                    }
                } else if let error {
                    ContentUnavailableView {
                        Label("No forecast", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await load() } }
                    }
                }
            }
            .navigationTitle(place?.label.components(separatedBy: ",").first ?? "Forecast")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { choosing = true } label: { Label("Change place", systemImage: "magnifyingglass") }
                }
                ToolbarItem(placement: .secondaryAction) {
                    Button { Task { await useLocation() } } label: { Label("Use my location", systemImage: "location") }
                }
            }
            .safeAreaInset(edge: .top) {
                if let banner = model.banner { BannerView(text: banner) }
            }
            .refreshable { await load() }
            .sheet(isPresented: $choosing) {
                NavigationStack {
                    PlaceSearchView { picked in
                        place = picked
                        model.settings.lastPlace = picked
                        Task { await load() }
                    }
                }
            }
            .task {
                if place == nil, let saved = model.settings.lastPlace {
                    place = saved
                    await load()
                }
            }
        }
    }

    private func load() async {
        guard let place else { return }
        loading = forecast == nil
        error = nil
        defer { loading = false }
        do {
            forecast = try await model.api.forecast(latitude: place.latitude, longitude: place.longitude, timezone: place.timezone)
        } catch {
            self.error = error.localizedDescription
            if forecast != nil { model.banner = error.localizedDescription }
        }
    }

    private func useLocation() async {
        do {
            let picked = try await location.currentPlace()
            place = picked
            model.settings.lastPlace = picked
            forecast = nil
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Pure presentation of a forecast (reusable on macOS).
struct ForecastView: View {
    let place: Place
    let forecast: Forecast
    var now: Date = Date()

    private var tz: TimeZone { forecast.timeZone }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                currentCard
                hourlyStrip
                dailyList
            }
            .padding()
        }
    }

    private var currentCard: some View {
        let cur = forecast.current
        let code = WeatherFormat.describe(code: cur?["weather_code"], isDay: (cur?["is_day"] ?? 1) == 1)
        return VStack(alignment: .leading, spacing: 8) {
            Text(place.label).font(.title2.bold())
            Text(cur.map { "\(code.text) · updated \(WeatherFormat.time($0.time, timeZone: tz))" } ?? "Current conditions unavailable")
                .font(.footnote).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(systemName: code.symbol).font(.system(size: 44)).symbolRenderingMode(.multicolor)
                Text(WeatherFormat.temperature(cur?["temperature_2m"], unit: forecast.unit("temperature_2m", fallback: "°C")))
                    .font(.system(size: 56, weight: .light))
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)], alignment: .leading, spacing: 8) {
                detail("Feels like", WeatherFormat.temperature(cur?["apparent_temperature"], unit: forecast.unit("apparent_temperature", fallback: "°C")))
                detail("Humidity", WeatherFormat.number(cur?["relative_humidity_2m"], unit: "%"))
                detail("Wind", "\(WeatherFormat.number(cur?["wind_speed_10m"], unit: forecast.unit("wind_speed_10m", fallback: "km/h"))) \(WeatherFormat.compass(cur?["wind_direction_10m"]))")
                detail("Gusts", WeatherFormat.number(cur?["wind_gusts_10m"], unit: forecast.unit("wind_gusts_10m", fallback: "km/h")))
                detail("Precipitation", WeatherFormat.number(cur?["precipitation"], unit: forecast.unit("precipitation", fallback: "mm"), digits: 1))
                detail("Cloud cover", WeatherFormat.number(cur?["cloud_cover"], unit: "%"))
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
    }

    private func detail(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.medium))
        }
    }

    private var hourlyStrip: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Next 24 hours").font(.headline)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(forecast.upcomingHourIndices(hours: 24, now: now), id: \.self) { i in
                        let code = WeatherFormat.describe(code: forecast.hourly.value("weather_code", at: i),
                                                          isDay: (forecast.hourly.value("is_day", at: i) ?? 1) == 1)
                        VStack(spacing: 6) {
                            Text(WeatherFormat.hour(forecast.hourly.time[i], timeZone: tz)).font(.caption).foregroundStyle(.secondary)
                            Image(systemName: code.symbol).symbolRenderingMode(.multicolor).frame(height: 22)
                            Text(WeatherFormat.temperature(forecast.hourly.value("temperature_2m", at: i))).font(.callout.weight(.medium))
                            Text(WeatherFormat.number(forecast.hourly.value("precipitation_probability", at: i), unit: "%"))
                                .font(.caption2).foregroundStyle(.blue)
                        }
                        .frame(minWidth: 44)
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private var dailyList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("7 days").font(.headline)
            ForEach(Array(forecast.daily.time.prefix(7).enumerated()), id: \.offset) { i, time in
                let code = WeatherFormat.describe(code: forecast.daily.value("weather_code", at: i))
                HStack {
                    Text(WeatherFormat.day(time, timeZone: tz, now: now)).frame(width: 64, alignment: .leading)
                    Image(systemName: code.symbol).symbolRenderingMode(.multicolor).frame(width: 28)
                    Text(code.text).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    Text(WeatherFormat.number(forecast.daily.value("precipitation_probability_max", at: i), unit: "%"))
                        .font(.caption).foregroundStyle(.blue).frame(width: 44, alignment: .trailing)
                    Text("\(WeatherFormat.temperature(forecast.daily.value("temperature_2m_min", at: i))) / \(WeatherFormat.temperature(forecast.daily.value("temperature_2m_max", at: i)))")
                        .font(.callout.weight(.medium)).monospacedDigit().frame(width: 84, alignment: .trailing)
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
                if i < min(7, forecast.daily.time.count) - 1 { Divider() }
            }
        }
    }
}
