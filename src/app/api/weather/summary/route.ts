import { NextResponse } from "next/server";
import { fetchYr } from "@/lib/weather/providers";
import { summarizeWeather } from "@/lib/weather/ai-summary";

// Serves the AI weather summary for the Yr weather widget. Kept server-side so
// the Anthropic key never reaches the browser; the heavy lifting (and the hourly
// cache) lives in ai-summary.ts.
const ALLOWED_TEMP = new Set(["celsius", "fahrenheit"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const tempUnitRaw = searchParams.get("temperature_unit") ?? "celsius";
  const tone = searchParams.get("tone") ?? "";
  const location = searchParams.get("location") ?? "";

  if (!lat || !lon) {
    return NextResponse.json({ error: "Latitude and Longitude are required" }, { status: 400 });
  }
  const tempUnit = ALLOWED_TEMP.has(tempUnitRaw) ? (tempUnitRaw as "celsius" | "fahrenheit") : "celsius";

  try {
    const weather = await fetchYr(lat, lon, { tempUnit, windUnit: "kmh" });
    const blurb = await summarizeWeather(weather, {
      cacheKey: `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`,
      locationLabel: location,
      tone,
      unitTemp: tempUnit,
    });
    return NextResponse.json(blurb); // { word, soon }
  } catch (error: any) {
    console.error("[Weather summary] Error:", error);
    return NextResponse.json({ error: error?.message ?? "summary_failed" }, { status: 500 });
  }
}
