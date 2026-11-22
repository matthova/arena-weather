/**
 * The Open-Meteo forecast variables a rule may reference.
 * Names are the exact Open-Meteo parameter names so the API can pass them straight through.
 * https://open-meteo.com/en/docs
 */
export type Granularity = "hourly" | "daily";

export interface WeatherVariable {
  /** Open-Meteo parameter name, e.g. `temperature_2m` */
  name: string;
  /** Human label for builders */
  label: string;
  /** Unit in Open-Meteo's default (metric) unit system */
  unit: string;
  granularity: Granularity;
}

export const HOURLY_VARIABLES = [
  { name: "temperature_2m", label: "Temperature (2 m)", unit: "°C", granularity: "hourly" },
  { name: "apparent_temperature", label: "Feels like", unit: "°C", granularity: "hourly" },
  { name: "relative_humidity_2m", label: "Relative humidity", unit: "%", granularity: "hourly" },
  { name: "dew_point_2m", label: "Dew point", unit: "°C", granularity: "hourly" },
  {
    name: "precipitation_probability",
    label: "Precipitation chance",
    unit: "%",
    granularity: "hourly",
  },
  { name: "precipitation", label: "Precipitation", unit: "mm", granularity: "hourly" },
  { name: "rain", label: "Rain", unit: "mm", granularity: "hourly" },
  { name: "showers", label: "Showers", unit: "mm", granularity: "hourly" },
  { name: "snowfall", label: "Snowfall", unit: "cm", granularity: "hourly" },
  { name: "snow_depth", label: "Snow depth", unit: "m", granularity: "hourly" },
  { name: "weather_code", label: "Weather code (WMO)", unit: "code", granularity: "hourly" },
  { name: "cloud_cover", label: "Cloud cover", unit: "%", granularity: "hourly" },
  { name: "visibility", label: "Visibility", unit: "m", granularity: "hourly" },
  { name: "wind_speed_10m", label: "Wind speed (10 m)", unit: "km/h", granularity: "hourly" },
  { name: "wind_gusts_10m", label: "Wind gusts (10 m)", unit: "km/h", granularity: "hourly" },
  { name: "wind_direction_10m", label: "Wind direction (10 m)", unit: "°", granularity: "hourly" },
  { name: "uv_index", label: "UV index", unit: "index", granularity: "hourly" },
  { name: "is_day", label: "Daylight", unit: "0/1", granularity: "hourly" },
  { name: "surface_pressure", label: "Surface pressure", unit: "hPa", granularity: "hourly" },
  { name: "freezing_level_height", label: "Freezing level", unit: "m", granularity: "hourly" },
] as const satisfies readonly WeatherVariable[];

export const DAILY_VARIABLES = [
  { name: "temperature_2m_max", label: "Max temperature", unit: "°C", granularity: "daily" },
  { name: "temperature_2m_min", label: "Min temperature", unit: "°C", granularity: "daily" },
  { name: "apparent_temperature_max", label: "Max feels like", unit: "°C", granularity: "daily" },
  { name: "apparent_temperature_min", label: "Min feels like", unit: "°C", granularity: "daily" },
  { name: "precipitation_sum", label: "Precipitation total", unit: "mm", granularity: "daily" },
  { name: "rain_sum", label: "Rain total", unit: "mm", granularity: "daily" },
  { name: "showers_sum", label: "Showers total", unit: "mm", granularity: "daily" },
  { name: "snowfall_sum", label: "Snowfall total", unit: "cm", granularity: "daily" },
  {
    name: "precipitation_hours",
    label: "Hours with precipitation",
    unit: "h",
    granularity: "daily",
  },
  {
    name: "precipitation_probability_max",
    label: "Max precipitation chance",
    unit: "%",
    granularity: "daily",
  },
  { name: "weather_code", label: "Weather code (WMO)", unit: "code", granularity: "daily" },
  { name: "wind_speed_10m_max", label: "Max wind speed", unit: "km/h", granularity: "daily" },
  { name: "wind_gusts_10m_max", label: "Max wind gusts", unit: "km/h", granularity: "daily" },
  { name: "uv_index_max", label: "Max UV index", unit: "index", granularity: "daily" },
  { name: "sunshine_duration", label: "Sunshine duration", unit: "s", granularity: "daily" },
  { name: "daylight_duration", label: "Daylight duration", unit: "s", granularity: "daily" },
] as const satisfies readonly WeatherVariable[];

export const VARIABLES: readonly WeatherVariable[] = [...HOURLY_VARIABLES, ...DAILY_VARIABLES];

export type HourlyVariableName = (typeof HOURLY_VARIABLES)[number]["name"];
export type DailyVariableName = (typeof DAILY_VARIABLES)[number]["name"];

export const HOURLY_VARIABLE_NAMES = HOURLY_VARIABLES.map((v) => v.name) as [
  HourlyVariableName,
  ...HourlyVariableName[],
];
export const DAILY_VARIABLE_NAMES = DAILY_VARIABLES.map((v) => v.name) as [
  DailyVariableName,
  ...DailyVariableName[],
];

export function findVariable(name: string, granularity: Granularity): WeatherVariable | undefined {
  const list = granularity === "hourly" ? HOURLY_VARIABLES : DAILY_VARIABLES;
  return (list as readonly WeatherVariable[]).find((v) => v.name === name);
}
