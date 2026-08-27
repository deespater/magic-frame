import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedWeather } from "./providers";
import { getAnthropicKey } from "./anthropic-credentials";

// AI weather blurb via Claude Haiku 4.5 — the cheapest current small model
// ($1/$5 per 1M in/out), plenty for two tiny fields. Deliberately no
// thinking/effort (Haiku takes neither, and this doesn't need it) and a tiny
// max_tokens for a short, cheap output.
//
// Cost control is the CACHE, not the model: regenerated at most once an hour per
// location, never per render. Prompt caching is pointless here — the prompt is
// smaller than Haiku's 4096-token cache minimum and changes each hour.
//
// Returns two fields the widget renders:
//   word — ONE word for the current weather (sunny, rainy, windy…), prepended to
//          the "feels like" line.
//   soon — a very short phrase about the next 1-2 hours if something notable
//          changes ("Rain in 2 hours", "Turning windy"); empty if nothing does.
const MODEL = "claude-haiku-4-5";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export type WeatherBlurb = { word: string; soon: string };

type CacheEntry = { value: WeatherBlurb; expires: number };
const cache = new Map<string, CacheEntry>();

export type SummaryOpts = {
  // Stable per location — combined with the hour to form the cache key.
  cacheKey: string;
  locationLabel?: string;
  // Free-text style hint for the "soon" phrase, e.g. "playful". Empty = neutral.
  tone?: string;
  unitTemp: "celsius" | "fahrenheit";
  // Minutes to add to UTC to reach the location's local time (from the display),
  // so the model can reason about evening/night/morning and time-of-day.
  tzOffsetMin?: number;
};

const EMPTY: WeatherBlurb = { word: "", soon: "" };


export async function summarizeWeather(weather: NormalizedWeather, opts: SummaryOpts): Promise<WeatherBlurb> {
  const key = await getAnthropicKey();
  if (!key) return EMPTY; // Not configured — widget falls back to a code-derived word.

  const hourBucket = Math.floor(Date.now() / CACHE_TTL_MS);
  const cacheId = `${opts.cacheKey}|${opts.tone ?? ""}|${opts.unitTemp}|${hourBucket}`;
  const cached = cache.get(cacheId);
  if (cached && cached.expires > Date.now()) return cached.value;

  const prompt = buildPrompt(weather, opts);
  try {
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 120,
      system:
        "You describe weather for an at-a-glance home display people use to plan the day — " +
        "what to wear, whether to pack a raincoat, how to dress a kid for kindergarten. " +
        'Return ONLY a JSON object {"word": string, "soon": string} and nothing else. ' +
        '"word" is ONE common lowercase word for the CURRENT weather — the single most salient ' +
        "(sunny, clear, cloudy, rainy, drizzly, snowy, foggy, windy, humid, hot, cold, stormy); " +
        "prefer windy when wind is strong. Do not use uncommon words like 'overcast'. " +
        '"soon" (3-5 words, never empty) names the NEXT notable weather EVENT or change ahead: ' +
        "rain starting or stopping, wind picking up or easing, clearing, clouding over, a temperature drop, frost. " +
        'Say what and roughly when, e.g. "Rain by 5pm", "Wind picking up tonight", "Clearing after noon", "Calm clear evening", "Turning colder later". ' +
        "Look as far ahead as needed: if the next few hours are unchanged, describe what changes later today or tonight. " +
        "If the current local time is already late evening or night, skip the quiet night and give a glimpse of TOMORROW MORNING instead, " +
        'e.g. "Wet morning ahead", "Frosty clear morning", "Mild dry morning". ' +
        'Be concrete and useful for planning — never vague filler like "clear for hours", "no change", or "staying the same". ' +
        "No markdown, no preamble, no emoji.",
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const blurb = parseBlurb(text);
    cache.set(cacheId, { value: blurb, expires: Date.now() + CACHE_TTL_MS });
    return blurb;
  } catch (e) {
    console.error("[AI summary] failed", e);
    return EMPTY;
  }
}


function parseBlurb(text: string): WeatherBlurb {
  try {
    // Tolerate the model wrapping the JSON in prose or fences.
    const match = text.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(match ? match[0] : text);
    const word = typeof obj.word === "string" ? obj.word.trim().toLowerCase() : "";
    const soon = typeof obj.soon === "string" ? obj.soon.trim() : "";
    // Keep 'word' to a single token even if the model got chatty.
    return { word: word.split(/\s+/)[0] ?? "", soon };
  } catch {
    return EMPTY;
  }
}


function buildPrompt(w: NormalizedWeather, opts: SummaryOpts): string {
  const unit = opts.unitTemp === "fahrenheit" ? "°F" : "°C";
  const round = (n: number | undefined) => (typeof n === "number" ? Math.round(n) : undefined);

  // Shift UTC by the display's offset, then read via getUTC* to get local
  // wall-clock — lets the model reason about evening/night/morning.
  const offsetMin = typeof opts.tzOffsetMin === "number" ? opts.tzOffsetMin : 0;
  const toLocal = (utcMs: number) => new Date(utcMs + offsetMin * 60000);
  const hhmm = (d: Date) =>
    `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;

  const lines: string[] = [];
  if (opts.locationLabel) lines.push(`Location: ${opts.locationLabel}`);
  lines.push(`Current local time: ${hhmm(toLocal(Date.now()))}`);
  lines.push(`Now: ${round(w.current.temperature_2m)}${unit}, ${wmoLabel(w.current.weather_code)}`);
  if (typeof w.current.wind_speed_10m === "number") lines.push(`Wind now: ${round(w.current.wind_speed_10m)}`);
  if (typeof w.current.relative_humidity_2m === "number") lines.push(`Humidity: ${round(w.current.relative_humidity_2m)}%`);
  if (typeof w.current.uv_index === "number") lines.push(`UV index: ${round(w.current.uv_index)}`);

  if (w.hourly?.time?.length) {
    // A longer horizon (up to 18h) with local hour, condition, rain chance and
    // wind, so the model can find the next real change rather than just the next
    // hour. Local hour labels so "evening"/"morning" line up.
    const n = Math.min(18, w.hourly.time.length);
    const trend: string[] = [];
    for (let i = 0; i < n; i++) {
      const hr = hhmm(toLocal(new Date(w.hourly.time[i]).getTime())).slice(0, 2);
      const t = round(w.hourly.temperature_2m[i]);
      const pop = w.hourly.precipitation_probability?.[i];
      const wind = round(w.hourly.wind_speed_10m?.[i]);
      const popStr = typeof pop === "number" && pop > 0 ? ` ${pop}%rain` : "";
      const windStr = typeof wind === "number" ? ` wind${wind}` : "";
      trend.push(`${hr}h ${t}${unit} ${wmoLabel(w.hourly.weather_code[i])}${popStr}${windStr}`);
    }
    lines.push(`Hourly (local): ${trend.join("; ")}`);
  }

  if (w.daily?.time?.length && w.daily.time.length > 1) {
    lines.push(
      `Tomorrow: high ${round(w.daily.temperature_2m_max[1])}${unit}, low ${round(w.daily.temperature_2m_min[1])}${unit}, ${wmoLabel(w.daily.weather_code[1])}`,
    );
  }

  const tone = (opts.tone || "").trim();
  if (tone) lines.push(`Tone for "soon": ${tone}`);
  return lines.join("\n");
}


// Minimal WMO weather-code → English label, for the prompt only.
function wmoLabel(code: number | undefined): string {
  const c = code ?? 0;
  if (c === 0) return "clear sky";
  if (c === 1) return "mainly clear";
  if (c === 2) return "partly cloudy";
  if (c === 3) return "overcast";
  if (c === 45 || c === 48) return "fog";
  if (c >= 51 && c <= 57) return "drizzle";
  if (c >= 61 && c <= 67) return "rain";
  if (c >= 71 && c <= 77) return "snow";
  if (c >= 80 && c <= 82) return "rain showers";
  if (c >= 85 && c <= 86) return "snow showers";
  if (c >= 95) return "thunderstorm";
  return "mixed";
}
