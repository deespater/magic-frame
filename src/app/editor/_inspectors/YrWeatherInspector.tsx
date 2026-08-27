"use client";

import React, { useEffect, useState } from "react";
import type { WidgetLayoutItem } from "../_types";
import { useT } from "@/lib/i18n/LocaleProvider";
import { normalizeIconSet } from "@/lib/weather/wmo";

type YrWeatherInspectorProps = {
  widget: WidgetLayoutItem;
  updateConfig: (i: string, key: string, value: any) => void;
  citySearchQuery: string;
  citySearchResults: any[];
  isSearchingCity: boolean;
  searchCity: (query: string) => void;
  setCitySearchResults: (v: any[]) => void;
  setCitySearchQuery: (v: string) => void;
};

export default function YrWeatherInspector({
  widget: activeWidget,
  updateConfig,
  citySearchQuery,
  citySearchResults,
  isSearchingCity,
  searchCity,
  setCitySearchResults,
  setCitySearchQuery,
}: YrWeatherInspectorProps) {
  const t = useT();
  const cfg = (activeWidget.config as any) || {};
  const aiOn = cfg.aiSummary !== false;

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[var(--mf-fg)]/50 leading-relaxed">
        {t("Wetter von Yr (MET Norway) mit optionaler KI-Zusammenfassung. Icons und Schrift wie beim Standard-Wetter-Widget.")}
      </p>

      {/* Location search (auto-fill lat/lon) */}
      <div className="relative">
        <label className="text-sm font-medium text-[var(--mf-fg)]/80 block mb-2 text-cyan-400">
          {t("Ort suchen (Auto-Ausfüllen)")}
        </label>
        {cfg.location && (
          <div className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2 mb-2">
            <span className="text-cyan-300 text-base shrink-0">📍</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[var(--mf-fg)]/60 uppercase tracking-wider">{t("Aktueller Ort")}</div>
              <div className="text-sm font-medium text-[var(--mf-fg)] truncate">{cfg.location}</div>
              <div className="text-[11px] text-[var(--mf-fg)]/40 font-mono mt-0.5">
                {cfg.lat}, {cfg.lon}
              </div>
            </div>
            <button
              onClick={() => {
                updateConfig(activeWidget.i, "location", "");
                updateConfig(activeWidget.i, "lat", "");
                updateConfig(activeWidget.i, "lon", "");
              }}
              title={t("Ort zurücksetzen")}
              className="text-xs text-[var(--mf-fg)]/50 hover:text-red-300 hover:bg-red-500/10 rounded w-7 h-7 flex items-center justify-center shrink-0"
            >
              ×
            </button>
          </div>
        )}
        <input
          type="text"
          value={citySearchQuery}
          placeholder={cfg.location ? t("Anderen Ort suchen…") : t("z.B. München...")}
          onChange={(e) => searchCity(e.target.value)}
          className="w-full bg-[var(--mf-surface)] border border-cyan-500/30 text-[var(--mf-fg)] font-sans text-sm rounded-lg p-3 focus:outline-none focus:border-cyan-400 transition-colors"
        />
        {isSearchingCity && <div className="absolute right-3 top-10 text-xs text-[var(--mf-fg)]/50">{t("Sucht...")}</div>}
        {citySearchResults.length > 0 && (
          <div className="absolute z-10 w-full mt-2 bg-[var(--mf-surface-2)] border border-[var(--mf-bdr)]/10 rounded-lg shadow-2xl max-h-[250px] overflow-y-auto">
            {citySearchResults.map((city) => (
              <div
                key={city.id}
                className="p-3 hover:bg-[var(--mf-elev)]/10 cursor-pointer border-b border-[var(--mf-bdr)]/5 last:border-0"
                onClick={() => {
                  updateConfig(activeWidget.i, "lat", city.latitude.toString());
                  updateConfig(activeWidget.i, "lon", city.longitude.toString());
                  updateConfig(activeWidget.i, "location", `${city.name}, ${city.admin1 || city.country}`);
                  setCitySearchResults([]);
                  setCitySearchQuery("");
                }}
              >
                <div className="font-bold text-[var(--mf-fg)]">{city.name}</div>
                <div className="text-xs text-[var(--mf-fg)]/60 mt-0.5">
                  {city.admin1 ? `${city.admin1}, ` : ""}
                  {city.country}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual lat/lon */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-[var(--mf-fg)]/40 block mb-2">{t("Latitude")}</label>
          <input
            type="text"
            value={cfg.lat || ""}
            placeholder="59.9139"
            onChange={(e) => updateConfig(activeWidget.i, "lat", e.target.value)}
            className="w-full bg-[var(--mf-surface)] border border-[var(--mf-bdr)]/5 text-[var(--mf-fg)]/50 font-sans text-sm rounded-lg p-2 focus:outline-none focus:border-[var(--mf-bdr)]/20"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--mf-fg)]/40 block mb-2">{t("Longitude")}</label>
          <input
            type="text"
            value={cfg.lon || ""}
            placeholder="10.7522"
            onChange={(e) => updateConfig(activeWidget.i, "lon", e.target.value)}
            className="w-full bg-[var(--mf-surface)] border border-[var(--mf-bdr)]/5 text-[var(--mf-fg)]/50 font-sans text-sm rounded-lg p-2 focus:outline-none focus:border-[var(--mf-bdr)]/20"
          />
        </div>
      </div>

      {/* Units + icon set */}
      <div className="grid grid-cols-2 gap-3 pt-4 border-t border-[var(--mf-bdr)]/10">
        <div>
          <label className="text-xs font-medium text-[var(--mf-fg)]/70 block mb-1.5">{t("Temperatur")}</label>
          <select
            value={cfg.unitTemp || "celsius"}
            onChange={(e) => updateConfig(activeWidget.i, "unitTemp", e.target.value)}
            className="w-full bg-[var(--mf-surface)] border border-[var(--mf-bdr)]/10 text-[var(--mf-fg)] text-sm rounded-lg p-2 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="celsius">°C</option>
            <option value="fahrenheit">°F</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--mf-fg)]/70 block mb-1.5">{t("Wind")}</label>
          <select
            value={cfg.unitWind || "kmh"}
            onChange={(e) => updateConfig(activeWidget.i, "unitWind", e.target.value)}
            className="w-full bg-[var(--mf-surface)] border border-[var(--mf-bdr)]/10 text-[var(--mf-fg)] text-sm rounded-lg p-2 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="kmh">km/h</option>
            <option value="mph">mph</option>
            <option value="ms">m/s</option>
            <option value="kn">{t("Knoten")}</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-[var(--mf-fg)]/80 block mb-2">{t("Icon Stil")}</label>
        <select
          value={normalizeIconSet(cfg.iconSet) || "lucide"}
          onChange={(e) => updateConfig(activeWidget.i, "iconSet", e.target.value)}
          className="w-full bg-[var(--mf-surface)] border border-[var(--mf-bdr)]/10 text-[var(--mf-fg)] font-sans text-sm rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none cursor-pointer"
        >
          <option value="lucide">{t("Lucide (Klar, Umriss)")}</option>
          <option value="solid">{t("Solid (Gefüllt, Flach)")}</option>
          <option value="meteocons">{t("Meteocons (Farbig, Animierbar)")}</option>
          <option value="3d">{t("3D (Plastisch, Animierbar)")}</option>
        </select>
      </div>

      {/* AI summary */}
      <div className="pt-4 mt-2 border-t border-[var(--mf-bdr)]/10 space-y-3">
        <label className="flex items-center gap-3 cursor-pointer group">
          <div className="relative">
            <input
              type="checkbox"
              checked={aiOn}
              onChange={(e) => updateConfig(activeWidget.i, "aiSummary", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-[var(--mf-elev)]/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-500"></div>
          </div>
          <span className="text-sm font-medium text-[var(--mf-fg)]/80 group-hover:text-[var(--mf-fg)] transition-colors">
            {t("KI-Zusammenfassung (Claude Haiku)")}
          </span>
        </label>
        <p className="text-[11px] text-[var(--mf-fg)]/40 -mt-1">
          {t("Ein Wort zum aktuellen Wetter plus ein kurzer Hinweis auf die nächsten 1-2 Stunden. Braucht einen Anthropic-API-Key in den Einstellungen oder ANTHROPIC_API_KEY.")}
        </p>
        {aiOn && (
          <>
            <div>
              <label className="text-xs font-medium text-[var(--mf-fg)]/70 block mb-1.5">{t("Ton (optional)")}</label>
              <input
                type="text"
                value={cfg.aiTone || ""}
                placeholder={t("z.B. verspielt, knapp, sachlich")}
                onChange={(e) => updateConfig(activeWidget.i, "aiTone", e.target.value)}
                className="w-full bg-[var(--mf-surface)] border border-[var(--mf-bdr)]/10 text-[var(--mf-fg)] text-sm rounded-lg p-2 focus:outline-none focus:border-violet-500"
              />
            </div>
            <AnthropicKeyField />
          </>
        )}
      </div>

      {/* Display name */}
      <div>
        <label className="text-xs font-medium text-[var(--mf-fg)]/40 block mb-2">{t("Anzeigename auf Dashboard")}</label>
        <input
          type="text"
          value={cfg.location || ""}
          placeholder="Oslo"
          onChange={(e) => updateConfig(activeWidget.i, "location", e.target.value)}
          className="w-full bg-[var(--mf-surface)] border border-[var(--mf-bdr)]/5 text-[var(--mf-fg)] font-sans text-sm rounded-lg p-3 focus:outline-none focus:border-[var(--mf-bdr)]/20"
        />
      </div>
    </div>
  );
}


// Anthropic API key field. The key is stored SERVER-SIDE (settings.extra.anthropic
// via /api/admin/anthropic-credentials) — never in the widget config, so it never
// reaches a display's browser. We only ever read back a "configured?" status.
function AnthropicKeyField() {
  const t = useT();
  const [status, setStatus] = useState<{ configured: boolean; fromEnv: boolean } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/anthropic-credentials")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.configured === "boolean") setStatus(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (keyInput.trim() === "") return;
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch("/api/admin/anthropic-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: keyInput.trim() }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.status) {
        setStatus(d.status);
        setKeyInput("");
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--mf-bdr)]/10 bg-[var(--mf-surface)]/40 p-3 space-y-2">
      <label className="text-xs font-medium text-[var(--mf-fg)]/70 block">
        {t("Anthropic API-Key (serverseitig gespeichert)")}
      </label>
      {status?.fromEnv ? (
        <p className="text-[11px] text-[var(--mf-fg)]/50">
          {t("Über die Server-Umgebung gesetzt (ANTHROPIC_API_KEY) — hier nicht änderbar.")}
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
                setSaved(false);
              }}
              placeholder={status?.configured ? t("Key gesetzt — neuen eingeben zum Ersetzen") : "sk-ant-..."}
              className="flex-1 min-w-0 bg-[var(--mf-surface)] border border-[var(--mf-bdr)]/10 text-[var(--mf-fg)] text-sm rounded-lg p-2 focus:outline-none focus:border-violet-500"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving || keyInput.trim() === ""}
              className="shrink-0 px-3 rounded-lg text-sm font-medium bg-violet-500/20 border border-violet-500/30 text-[var(--mf-fg)] disabled:opacity-40"
            >
              {saving ? t("Speichert…") : t("Key speichern")}
            </button>
          </div>
          <p className="text-[11px] text-[var(--mf-fg)]/40">
            {status?.configured ? `✓ ${t("Key gesetzt")}` : t("Kein Key gesetzt")}
            {saved ? ` · ${t("Gespeichert!")}` : ""} · {t("Wird serverseitig gespeichert, nie im Layout.")}
          </p>
        </>
      )}
    </div>
  );
}
