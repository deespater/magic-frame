import "server-only";
import { getAppSettings } from "@/lib/settings/store";

export type WeatherUnits = {
  tempUnit: "celsius" | "fahrenheit";
  windUnit: "kmh" | "mph" | "ms" | "kn";
};

export type NormalizedWeather = {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    is_day?: number;
    uv_index?: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunrise?: string[];
    sunset?: string[];
    uv_index_max?: number[];
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
    precipitation_probability?: number[];
    is_day?: number[];
  };
  _provider?: string;
};

export async function fetchOpenMeteo(
  lat: string,
  lon: string,
  units: WeatherUnits,
  endpoint: "forecast" | "dwd-icon" = "forecast",
): Promise<NormalizedWeather> {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m,is_day,uv_index",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max",
    hourly: "temperature_2m,weather_code,precipitation_probability,is_day",
    forecast_days: "7",
    timezone: "auto",
    temperature_unit: units.tempUnit,
    wind_speed_unit: units.windUnit,
  });

  // DWD-ICON-Modell liefert keinen UV-Index. Wir feuern parallel einen
  // schlanken Request gegen das Standard-Open-Meteo-Forecast-Modell nur für
  // UV (current + daily.uv_index_max) und mergen das später ins DWD-Result.
  // Schlägt der Fallback fehl → einfach kein UV (silent), Haupt-Fetch bleibt
  // funktional.
  const uvFallbackPromise =
    endpoint === "dwd-icon"
      ? fetchUvFromStandardOpenMeteo(lat, lon).catch(() => null)
      : null;

  const res = await fetch(`https://api.open-meteo.com/v1/${endpoint}?${params.toString()}`, {
    next: { revalidate: 60 * 15 },
  });
  if (!res.ok) throw new Error(`${endpoint} ${res.status}`);
  const data = await res.json();

  if (uvFallbackPromise) {
    const uv = await uvFallbackPromise;
    if (uv) {
      if (data.current && (data.current.uv_index === undefined || data.current.uv_index === null)) {
        data.current.uv_index = uv.current;
      }
      if (data.daily && Array.isArray(uv.dailyMax) && uv.dailyMax.length > 0) {
        // DWD daily-Array könnte bereits da sein, aber `uv_index_max` fehlt
        data.daily.uv_index_max = uv.dailyMax;
      }
    }
  }

  return { ...data, _provider: endpoint === "dwd-icon" ? "dwd" : "open-meteo" };
}

async function fetchUvFromStandardOpenMeteo(
  lat: string,
  lon: string,
): Promise<{ current: number | undefined; dailyMax: number[] | undefined } | null> {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "uv_index",
    daily: "uv_index_max",
    forecast_days: "7",
    timezone: "auto",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    next: { revalidate: 60 * 15 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    current: typeof data.current?.uv_index === "number" ? data.current.uv_index : undefined,
    dailyMax: Array.isArray(data.daily?.uv_index_max) ? data.daily.uv_index_max : undefined,
  };
}

export async function fetchOpenWeatherMap(
  lat: string,
  lon: string,
  units: WeatherUnits,
): Promise<NormalizedWeather> {
  const { getOwmKey } = await import("./owm-credentials");
  const key = await getOwmKey();
  if (!key) throw new Error("owm_not_configured");

  // OWM: 'metric' (°C, m/s) oder 'imperial' (°F, mph). Wind-Umrechnung danach.
  const owmUnits = units.tempUnit === "fahrenheit" ? "imperial" : "metric";
  const url = new URL("https://api.openweathermap.org/data/3.0/onecall");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("units", owmUnits);
  url.searchParams.set("exclude", "minutely,alerts");
  url.searchParams.set("appid", key);

  const res = await fetch(url.toString(), { next: { revalidate: 60 * 15 } });
  if (!res.ok) throw new Error(`owm ${res.status}`);
  const data = await res.json();

  const convertWind = (n: number): number => {
    // OWM metric = m/s, imperial = mph.
    if (owmUnits === "metric") {
      if (units.windUnit === "kmh") return n * 3.6;
      if (units.windUnit === "ms") return n;
      if (units.windUnit === "kn") return n * 1.94384;
      return n * 3.6;
    }
    // imperial → mph
    if (units.windUnit === "mph") return n;
    if (units.windUnit === "kmh") return n * 1.60934;
    if (units.windUnit === "ms") return n * 0.44704;
    if (units.windUnit === "kn") return n * 0.868976;
    return n;
  };

  const currentCode = owmToWmo(data.current?.weather?.[0]?.id);
  const dailyArr = Array.isArray(data.daily) ? data.daily.slice(0, 6) : [];

  const toISODate = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
  const toISODateTime = (sec: number) => new Date(sec * 1000).toISOString();

  return {
    current: {
      temperature_2m: data.current?.temp ?? 0,
      apparent_temperature: data.current?.feels_like ?? data.current?.temp ?? 0,
      weather_code: currentCode,
      relative_humidity_2m: data.current?.humidity,
      wind_speed_10m:
        typeof data.current?.wind_speed === "number" ? convertWind(data.current.wind_speed) : undefined,
      is_day:
        data.current?.sunrise && data.current?.sunset && data.current?.dt
          ? data.current.dt >= data.current.sunrise && data.current.dt <= data.current.sunset
            ? 1
            : 0
          : undefined,
      uv_index: typeof data.current?.uvi === "number" ? data.current.uvi : undefined,
    },
    daily: {
      time: dailyArr.map((d: any) => toISODate(d.dt)),
      weather_code: dailyArr.map((d: any) => owmToWmo(d.weather?.[0]?.id)),
      temperature_2m_max: dailyArr.map((d: any) => d.temp?.max ?? 0),
      temperature_2m_min: dailyArr.map((d: any) => d.temp?.min ?? 0),
      sunrise: dailyArr.map((d: any) => (d.sunrise ? toISODateTime(d.sunrise) : "")),
      sunset: dailyArr.map((d: any) => (d.sunset ? toISODateTime(d.sunset) : "")),
      uv_index_max: dailyArr.map((d: any) => (typeof d.uvi === "number" ? d.uvi : 0)),
    },
    hourly: (() => {
      const hourlyArr = Array.isArray(data.hourly) ? data.hourly.slice(0, 48) : [];
      if (hourlyArr.length === 0) return undefined;
      return {
        time: hourlyArr.map((h: any) => toISODateTime(h.dt)),
        temperature_2m: hourlyArr.map((h: any) => h.temp ?? 0),
        weather_code: hourlyArr.map((h: any) => owmToWmo(h.weather?.[0]?.id)),
        precipitation_probability: hourlyArr.map((h: any) => Math.round((h.pop ?? 0) * 100)),
        is_day: hourlyArr.map((h: any) =>
          data.current?.sunrise && data.current?.sunset
            ? h.dt % 86400 >= (data.current.sunrise % 86400) && h.dt % 86400 <= (data.current.sunset % 86400)
              ? 1 : 0
            : 1,
        ),
      };
    })(),
    _provider: "openweathermap",
  };
}

// MET Norway (Yr) — locationforecast/2.0. Free, no API key, but the terms of
// service REQUIRE an identifying User-Agent (a default/empty one is blocked with
// 403). Temperatures come in °C and wind in m/s; we convert to the requested
// units. The forecast is a flat list of timesteps, so the daily view is built by
// grouping timesteps per calendar day.
const YR_ENDPOINT = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
const YR_USER_AGENT = "MagicFrame/1.x github.com/jeremiaa/magic-frame";

export async function fetchYr(
  lat: string,
  lon: string,
  units: WeatherUnits,
): Promise<NormalizedWeather> {
  // MET Norway asks callers to round coordinates to ~4 decimals (fewer distinct
  // cache keys on their side). Anything finer is rejected as an over-precise req.
  const q = new URLSearchParams({
    lat: Number(lat).toFixed(4),
    lon: Number(lon).toFixed(4),
  });
  const res = await fetch(`${YR_ENDPOINT}?${q.toString()}`, {
    headers: { "User-Agent": YR_USER_AGENT },
    next: { revalidate: 60 * 15 },
  });
  if (!res.ok) throw new Error(`yr ${res.status}`);
  const data = await res.json();

  const series: any[] = Array.isArray(data?.properties?.timeseries)
    ? data.properties.timeseries
    : [];
  if (series.length === 0) throw new Error("yr_empty");

  // m/s → requested wind unit
  const convertWind = (ms: number): number => {
    if (units.windUnit === "kmh") return ms * 3.6;
    if (units.windUnit === "mph") return ms * 2.236936;
    if (units.windUnit === "kn") return ms * 1.943844;
    return ms; // ms
  };
  const toF = (c: number) => (c * 9) / 5 + 32;
  const temp = (c: number) => (units.tempUnit === "fahrenheit" ? toF(c) : c);

  const now = series[0];
  const nowInstant = now?.data?.instant?.details ?? {};
  const nowSymbol =
    now?.data?.next_1_hours?.summary?.symbol_code ??
    now?.data?.next_6_hours?.summary?.symbol_code ??
    "";

  const current = {
    temperature_2m: temp(Number(nowInstant.air_temperature ?? 0)),
    apparent_temperature: temp(Number(nowInstant.air_temperature ?? 0)),
    weather_code: yrSymbolToWmo(nowSymbol),
    relative_humidity_2m:
      typeof nowInstant.relative_humidity === "number" ? nowInstant.relative_humidity : undefined,
    wind_speed_10m:
      typeof nowInstant.wind_speed === "number" ? convertWind(nowInstant.wind_speed) : undefined,
    is_day: yrIsDay(nowSymbol),
    uv_index:
      typeof nowInstant.ultraviolet_index_clear_sky === "number"
        ? nowInstant.ultraviolet_index_clear_sky
        : undefined,
  };

  // Hourly — the compact feed is hourly for ~2-3 days, then coarser. Cap at 48.
  const hourlySlice = series.slice(0, 48);
  const hourly = {
    time: hourlySlice.map((s) => String(s.time)),
    temperature_2m: hourlySlice.map((s) => temp(Number(s?.data?.instant?.details?.air_temperature ?? 0))),
    weather_code: hourlySlice.map((s) =>
      yrSymbolToWmo(s?.data?.next_1_hours?.summary?.symbol_code ?? s?.data?.next_6_hours?.summary?.symbol_code ?? ""),
    ),
    precipitation_probability: hourlySlice.map((s) => {
      const p = s?.data?.next_1_hours?.details?.probability_of_precipitation;
      return typeof p === "number" ? Math.round(p) : 0;
    }),
    is_day: hourlySlice.map((s) =>
      yrIsDay(s?.data?.next_1_hours?.summary?.symbol_code ?? s?.data?.next_6_hours?.summary?.symbol_code ?? "") ?? 1,
    ),
  };

  // Daily — group timesteps by calendar day, take min/max of the instant temps
  // and the symbol nearest local noon as that day's representative condition.
  const byDay = new Map<string, { temps: number[]; noon?: { diff: number; symbol: string } }>();
  for (const s of series) {
    const iso = String(s.time);
    const day = iso.slice(0, 10);
    const t = s?.data?.instant?.details?.air_temperature;
    if (typeof t !== "number") continue;
    const entry = byDay.get(day) ?? { temps: [] };
    entry.temps.push(t);
    const hour = new Date(iso).getUTCHours();
    const diff = Math.abs(hour - 12);
    const symbol =
      s?.data?.next_6_hours?.summary?.symbol_code ?? s?.data?.next_1_hours?.summary?.symbol_code ?? "";
    if (symbol && (!entry.noon || diff < entry.noon.diff)) {
      entry.noon = { diff, symbol };
    }
    byDay.set(day, entry);
  }
  const days = Array.from(byDay.entries()).slice(0, 7);
  const daily = {
    time: days.map(([day]) => day),
    weather_code: days.map(([, v]) => yrSymbolToWmo(v.noon?.symbol ?? "")),
    temperature_2m_max: days.map(([, v]) => temp(Math.max(...v.temps))),
    temperature_2m_min: days.map(([, v]) => temp(Math.min(...v.temps))),
    sunrise: [],
    sunset: [],
  };

  return { current, daily, hourly, _provider: "yr" };
}

// MET Norway symbol_code → WMO code, for icon parity with the other providers.
// Codes carry a _day / _night / _polartwilight suffix we strip first; the base
// is matched by keyword so the ~100 variants collapse to a handful of buckets.
function yrSymbolToWmo(code: string): number {
  const c = (code || "").replace(/_(day|night|polartwilight)$/, "");
  if (!c) return 3;
  if (c.includes("thunder")) return 95;
  if (c.includes("sleet")) return 67;
  if (c.includes("snow")) {
    if (c.includes("showers")) return 85;
    if (c.includes("heavy")) return 75;
    if (c.includes("light")) return 71;
    return 73;
  }
  if (c.includes("rain")) {
    if (c.includes("showers")) return c.includes("heavy") ? 82 : c.includes("light") ? 80 : 81;
    if (c.includes("heavy")) return 65;
    if (c.includes("light")) return 61;
    return 63;
  }
  if (c.includes("drizzle")) return 51;
  if (c.includes("fog")) return 45;
  if (c === "cloudy") return 3;
  if (c === "partlycloudy") return 2;
  if (c === "fair") return 1;
  if (c === "clearsky") return 0;
  return 3;
}

// day/night from the symbol suffix. Undefined when the code has no suffix (e.g.
// the plain "cloudy"), so the widget falls back to its own clock-based check.
function yrIsDay(code: string): number | undefined {
  if (/_day$/.test(code)) return 1;
  if (/_night$/.test(code)) return 0;
  return undefined;
}

export async function fetchHomeAssistantWeather(
  entityId: string,
  _units: WeatherUnits,
): Promise<NormalizedWeather> {
  const settings = await getAppSettings();
  if (!settings.haUrl || !settings.haToken) throw new Error("ha_not_configured");

  const base = settings.haUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${settings.haToken}`,
    "Content-Type": "application/json",
  };

  // 1. Aktueller Zustand inkl. attributes
  const stateRes = await fetch(`${base}/api/states/${encodeURIComponent(entityId)}`, {
    headers,
    cache: "no-store",
  });
  if (!stateRes.ok) throw new Error(`ha ${stateRes.status}`);
  const entity = await stateRes.json();

  const attr = entity?.attributes ?? {};
  const condition: string = entity?.state ?? attr.condition ?? "unknown";
  const currentCode = haConditionToWmo(condition);

  // 2. Forecast. Zuerst den modernen Service-Call (HA 2024.3+), der
  //    attributes.forecast ersetzt hat. Fallback: altes attributes.forecast.
  let dailyForecast: any[] = [];
  try {
    const fcRes = await fetch(
      `${base}/api/services/weather/get_forecasts?return_response`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ entity_id: entityId, type: "daily" }),
        cache: "no-store",
      },
    );
    if (fcRes.ok) {
      const payload = await fcRes.json();
      // payload: { changed_states: [...], service_response: { [entityId]: { forecast: [...] } } }
      const sr = payload?.service_response ?? payload?.[0]?.service_response ?? {};
      const entry = sr?.[entityId];
      const arr = Array.isArray(entry?.forecast) ? entry.forecast : [];
      dailyForecast = arr.slice(0, 6);
    }
  } catch {
    // ignore, fällt auf attributes.forecast zurück
  }
  if (dailyForecast.length === 0 && Array.isArray(attr.forecast)) {
    dailyForecast = attr.forecast.slice(0, 6);
  }

  // Stündliche Vorhersage (optional — nicht jede HA-Weather-Integration bietet das)
  let hourlyForecast: any[] = [];
  try {
    const hfRes = await fetch(
      `${base}/api/services/weather/get_forecasts?return_response`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ entity_id: entityId, type: "hourly" }),
        cache: "no-store",
      },
    );
    if (hfRes.ok) {
      const payload = await hfRes.json();
      const sr = payload?.service_response ?? {};
      const entry = sr?.[entityId];
      const arr = Array.isArray(entry?.forecast) ? entry.forecast : [];
      hourlyForecast = arr.slice(0, 24);
    }
  } catch {}

  // Nacht-Erkennung:
  //  1) Condition-String (clear-night) als stärkstes Signal
  //  2) sun.sun-Entity abfragen (steht in fast jedem HA; state = above_horizon / below_horizon)
  //  3) Wenn beides nicht verfügbar → is_day weglassen, Widget fällt auf
  //     Browser-Time-Check zurück (Server läuft in UTC, darum NICHT hier raten).
  const isNightByCondition = condition === "clear-night" || condition.includes("night");
  let is_day: number | undefined = undefined;
  if (isNightByCondition) {
    is_day = 0;
  } else {
    try {
      const sunRes = await fetch(`${base}/api/states/sun.sun`, { headers, cache: "no-store" });
      if (sunRes.ok) {
        const sun = await sunRes.json();
        if (sun?.state === "above_horizon") is_day = 1;
        else if (sun?.state === "below_horizon") is_day = 0;
      }
    } catch {}
  }

  return {
    current: {
      temperature_2m: typeof attr.temperature === "number" ? attr.temperature : 0,
      apparent_temperature:
        typeof attr.apparent_temperature === "number" ? attr.apparent_temperature : (attr.temperature ?? 0),
      weather_code: currentCode,
      relative_humidity_2m: attr.humidity,
      wind_speed_10m: attr.wind_speed,
      is_day,
      uv_index: typeof attr.uv_index === "number" ? attr.uv_index : undefined,
    },
    daily: {
      time: dailyForecast.map((d: any) => String(d.datetime ?? "").slice(0, 10)),
      weather_code: dailyForecast.map((d: any) => haConditionToWmo(d.condition ?? "")),
      temperature_2m_max: dailyForecast.map((d: any) => d.temperature ?? 0),
      temperature_2m_min: dailyForecast.map((d: any) => d.templow ?? d.temperature ?? 0),
      sunrise: [],
      sunset: [],
    },
    hourly: hourlyForecast.length > 0 ? {
      time: hourlyForecast.map((h: any) => String(h.datetime ?? "")),
      temperature_2m: hourlyForecast.map((h: any) => h.temperature ?? 0),
      weather_code: hourlyForecast.map((h: any) => haConditionToWmo(h.condition ?? "")),
      precipitation_probability: hourlyForecast.map((h: any) =>
        typeof h.precipitation_probability === "number" ? h.precipitation_probability : 0,
      ),
    } : undefined,
    _provider: "home-assistant",
  };
}

// OWM-Condition-IDs → WMO-Codes (grobe Abbildung, Icon-Parität mit Open-Meteo)
function owmToWmo(id?: number): number {
  if (!id) return 0;
  if (id >= 200 && id < 300) return 95; // Thunderstorm
  if (id >= 300 && id < 400) return 51; // Drizzle
  if (id >= 500 && id < 600) {
    if (id >= 502) return 65; // heavy rain
    return 63; // rain
  }
  if (id >= 600 && id < 700) return 73; // snow
  if (id >= 700 && id < 800) return 45; // atmosphere (fog, haze)
  if (id === 800) return 0; // clear
  if (id === 801) return 1; // few clouds
  if (id === 802) return 2; // scattered clouds
  if (id === 803 || id === 804) return 3; // broken / overcast
  return 0;
}

// HA-weather.* conditions → WMO-Codes
function haConditionToWmo(c: string): number {
  switch (c) {
    case "sunny":
    case "clear":
    case "clear-night":
      return 0;
    case "partlycloudy":
      return 2;
    case "cloudy":
      return 3;
    case "rainy":
      return 61;
    case "pouring":
      return 65;
    case "snowy":
      return 73;
    case "snowy-rainy":
      return 67;
    case "fog":
      return 45;
    case "lightning":
    case "lightning-rainy":
      return 95;
    case "hail":
      return 77;
    case "windy":
    case "windy-variant":
      return 0;
    case "exceptional":
    default:
      return 3;
  }
}
