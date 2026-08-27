"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Wind, Sun } from "lucide-react";
import { wmoToIcon, moonPhaseFraction } from "@/lib/weather/wmo";
import { useLocale } from "@/lib/i18n/LocaleProvider";

// Yr weather widget — MET Norway (Yr) data, laid out like the standard weather
// widget (same fonts + icons) but with two AI touches:
//   • a one-word condition prepended to the "feels like" line (WINDY, FEELS…)
//   • a short "what changes soon" line from the next 1-2 hours
// The right column shows the next 3 hours instead of the 3-day outlook, and the
// sunrise/sunset line is gone. AI text is optional: without an Anthropic key the
// word falls back to a code-derived label and the "soon" line hides itself.

type Blurb = { word: string; soon: string };

export default function YrWeatherWidget({
  config,
  location,
  lat,
  lon,
}: {
  config?: any;
  location?: string;
  lat?: string;
  lon?: string;
}) {
  const { t } = useLocale();
  const [data, setData] = useState<any>(null);
  const [blurb, setBlurb] = useState<Blurb>({ word: "", soon: "" });
  const [error, setError] = useState<string | null>(null);
  // Timestamp of the last successful weather fetch, for the "Last updated" line.
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // Minute tick so day/night flips without a fresh fetch (see WeatherWidget).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  const unitTemp: "celsius" | "fahrenheit" = config?.unitTemp === "fahrenheit" ? "fahrenheit" : "celsius";
  const unitWind: "kmh" | "mph" | "ms" | "kn" =
    config?.unitWind === "mph" || config?.unitWind === "ms" || config?.unitWind === "kn" ? config.unitWind : "kmh";
  const tone: string = config?.aiTone || "";
  const aiEnabled = config?.aiSummary !== false;

  useEffect(() => {
    if (!lat || !lon) return;
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      try {
        const qs = new URLSearchParams({ temperature_unit: unitTemp, wind_speed_unit: unitWind, provider: "yr" });
        qs.set("lat", String(lat));
        qs.set("lon", String(lon));
        const res = await fetch(`/api/weather?${qs.toString()}`, { signal: controller.signal });
        const result = await res.json();
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
          return;
        }
        setData(result);
        setError(null);
        setLastUpdated(Date.now());
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        if (!cancelled) setError(t("Wetterdaten nicht verfügbar"));
      }
    };

    const loadBlurb = async () => {
      if (!aiEnabled) {
        setBlurb({ word: "", soon: "" });
        return;
      }
      try {
        const qs = new URLSearchParams({ temperature_unit: unitTemp, lat: String(lat), lon: String(lon) });
        // Minutes ahead of UTC at the display, so the AI can reason about local
        // evening/night/morning.
        qs.set("tz", String(-new Date().getTimezoneOffset()));
        if (tone) qs.set("tone", tone);
        if (location) qs.set("location", location);
        const res = await fetch(`/api/weather/summary?${qs.toString()}`, { signal: controller.signal });
        const result = await res.json();
        if (cancelled || result?.error) return;
        setBlurb({ word: result.word || "", soon: result.soon || "" });
      } catch {
        /* AI is best-effort — leave the fallback word in place. */
      }
    };

    load();
    loadBlurb();
    const interval = setInterval(() => {
      load();
      loadBlurb();
    }, 15 * 60 * 1000);
    const onWake = () => {
      if (document.visibilityState === "visible") {
        load();
        loadBlurb();
      }
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [lat, lon, unitTemp, unitWind, tone, location, aiEnabled]);

  if (!lat || !lon) {
    return (
      <div className="text-white/50 text-sm text-center">
        {t("Wetter")}
        <br />({t("Lat/Lon in Config eintragen")})
      </div>
    );
  }
  if (error) return <div className="text-red-400/80 text-sm text-center">⚠ {t(error)}</div>;
  if (!data) return <div className="text-white/50 text-sm">{t("Lade Wetter…")}</div>;

  const tempSuffix = unitTemp === "fahrenheit" ? "°F" : "°";
  const windUnitLabel = unitWind === "mph" ? "mph" : unitWind === "ms" ? "m/s" : unitWind === "kn" ? "kn" : "km/h";
  const currentTemp = Math.round(data.current.temperature_2m);
  const feelsLike = Math.round(data.current.apparent_temperature);
  const currentCode = data.current.weather_code;
  const windSpeed = data.current.wind_speed_10m;
  const uv = typeof data.current?.uv_index === "number" ? data.current.uv_index : undefined;

  const nowD = new Date(nowTick);
  // 24-hour clock, no seconds — re-renders each minute via nowTick.
  const timeStr = `${nowD.getHours().toString().padStart(2, "0")}:${nowD.getMinutes().toString().padStart(2, "0")}`;
  // Relative "last updated" — recomputes each minute via nowTick.
  const updatedAgo = lastUpdated ? relativeAgo(lastUpdated, nowTick) : "";
  const isNight =
    typeof data.current.is_day === "number" ? data.current.is_day === 0 : nowD.getHours() < 6 || nowD.getHours() > 20;

  const baseWord = blurb.word || fallbackWord(currentCode);
  const word = baseWord.toUpperCase();
  // Always show a near-term line. AI fills it when available; otherwise a plain
  // "staying <condition>" so the slot is never empty.
  const soonText = blurb.soon || `${t("Bleibt")} ${baseWord}`;

  // Next 3 hours, starting at the NEXT hour — the current conditions are already
  // shown big above, so "Now" would be redundant.
  const hourly = (() => {
    const h = data.hourly;
    if (!h || !Array.isArray(h.time)) return [];
    const now = Date.now();
    let startIdx = h.time.findIndex((iso: string) => new Date(iso).getTime() > now);
    if (startIdx < 0) startIdx = 0;
    return h.time.slice(startIdx, startIdx + 3).map((iso: string, i: number) => {
      const idx = startIdx + i;
      const d = new Date(iso);
      return {
        label: `${d.getHours().toString().padStart(2, "0")}:00`,
        temp: Math.round(h.temperature_2m[idx] ?? 0),
        code: h.weather_code[idx] ?? 0,
        isDay: typeof h.is_day?.[idx] === "number" ? h.is_day[idx] === 1 : true,
      };
    });
  })();

  const iconOpts = {
    style: config?.meteoconsStyle,
    animated: config?.meteoconsAnimated,
    moonPhase: (config?.meteoconsMoonPhase ?? true) ? moonPhaseFraction(nowD) : undefined,
  };
  const statStyle: CSSProperties = { width: "1em", height: "1em" };

  return (
    // 480×480 personal panel: two big numbers on the top corners (temp left,
    // clock right), condition lines in the middle-left, and wind/UV + the
    // 3-hour strip on the bottom corners. justify-between fills the tile height
    // without stacking the two 4.6em numbers vertically (which overflowed).
    <div className="relative flex flex-col justify-between w-full h-full overflow-hidden pt-[0.1em]">

      {/* Top row: temp + icon (left) · clock (right) */}
      <div className="flex items-center justify-between gap-[0.4em]" >
        <div className="flex items-center gap-[0.2em] min-w-0">
          <span style={{ fontSize: "4.6em" }} className="tracking-tighter leading-none">
            {currentTemp}
            {tempSuffix}
          </span>
          <div style={{ width: "4.6em", height: "4.6em" }} className="ml-2 shrink-0 flex items-center justify-center">
            {wmoToIcon(currentCode, !isNight, config?.iconSet, iconOpts)}
          </div>
        </div>
        <span style={{ fontSize: "4.6em" }} className="leading-none tracking-tighter tabular-nums shrink-0">
          {timeStr}
        </span>
      </div>

      {/* Middle: condition line, then near-term (left) sharing a row with the
          3-hour strip (right) */}
      <div className="min-w-0 flex flex-row items-start justify-between gap-[1em]">

        <div className="min-w-0 flex-1">
          <div style={{ fontSize: "1.25em", opacity: 0.85 }} className="uppercase tracking-wide text-ellipsis whitespace-nowrap overflow-hidden">
            {word}, {t("Fühlt sich an wie")} {feelsLike}
            {tempSuffix}
          </div>
          {/* near-term line: small gap from the condition line, and tight
              leading so a wrapped 2-line phrase reads as one unit */}
          <div style={{ fontSize: "1em", opacity: 0.65 }} className="mt-[0.25em] uppercase tracking-wide break-words line-clamp-2 leading-[1.15]">
            {soonText}
          </div>
        </div>

        <div className="flex items-center justify-between gap-[1em] shrink-0 mt-[2px]">
          {/* Bigger label/temp fonts, tighter gaps → same block footprint. */}
          {hourly.length > 0 && (
            <div className="flex gap-[0.75em] md:gap-[1em] items-center shrink-0">
              {hourly.map((h: any, i: number) => (
                <div key={i} className="flex flex-col items-center gap-[0.15em]">
                  <span style={{ fontSize: "1em" }} className="uppercase opacity-80 tracking-wide font-medium">
                    {h.label}
                  </span>
                  <div style={{ width: "1.2em", height: "1.2em" }} className="opacity-90 drop-shadow-sm">
                    {wmoToIcon(h.code, h.isDay, config?.iconSet, { style: config?.meteoconsStyle })}
                  </div>
                  <span style={{ fontSize: "0.95em" }} className="font-bold leading-none">
                    {h.temp}
                    {tempSuffix}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom-left: wind + UV */}
      <div style={{ fontSize: "16px", opacity: 0.8 }} className="flex justify-between items-end leading-none">
        <div className="flex items-center gap-x-[0.9em]">
          {windSpeed !== undefined && (
            <span className="inline-flex items-center gap-[0.3em]">
              <Wind style={statStyle} strokeWidth={2} className="opacity-80" />
              {Math.round(windSpeed)} {windUnitLabel}
            </span>
          )}
          <span className="inline-flex items-center gap-[0.3em]">
            <Sun style={statStyle} strokeWidth={2} className="opacity-80" />
            UV {Math.round(uv ?? 0)}
          </span>
        </div>

        {updatedAgo && (
          <div className="mr-0 opacity-70" style={{ fontSize: "12px" }}>
            {t("Aktualisiert")}: {updatedAgo}
          </div>
        )}
      </div>
    </div>
  );
}


// Short relative time for the "last updated" line: "just now", "5 min ago",
// "1 hour ago". Granularity is a minute, which matches the minute tick that
// drives it (data itself refreshes every 15 min).
function relativeAgo(fromMs: number, nowMs: number): string {
  const secs = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}


// Code-derived one-word condition, used when the AI word is unavailable.
function fallbackWord(code: number): string {
  const c = code ?? 0;
  if (c === 0 || c === 1) return "clear";
  if (c === 2) return "cloudy";
  if (c === 3) return "cloudy";
  if (c === 45 || c === 48) return "foggy";
  if (c >= 51 && c <= 57) return "drizzly";
  if (c >= 61 && c <= 67) return "rainy";
  if (c >= 71 && c <= 77) return "snowy";
  if (c >= 80 && c <= 82) return "showery";
  if (c >= 85 && c <= 86) return "snowy";
  if (c >= 95) return "stormy";
  return "mixed";
}
