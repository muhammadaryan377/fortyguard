import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  Droplets,
  Leaf,
  LoaderCircle,
  MapPin,
  ShieldAlert,
  Sparkles,
  SunMedium,
  ThermometerSun,
  Wind,
} from "lucide-react";

import { BAND_LABEL, finite } from "../productUtils.js";

function cToF(value) {
  const parsed = finite(value);
  return parsed === null ? null : (parsed * 9) / 5 + 32;
}

function kmhToMph(value) {
  const parsed = finite(value);
  return parsed === null ? null : parsed * 0.621371;
}

function rounded(value) {
  return finite(value) === null ? "--" : Math.round(Number(value));
}

function timeParts(value) {
  if (!value) return null;
  const text = String(value);
  const time = text.includes("T") ? text.split("T")[1] : text;
  const [hourText, minuteText = "00"] = (time || "").split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return null;
  return { hour, minute: Number(minuteText) || 0 };
}

function formatTime(value) {
  const parts = timeParts(value);
  if (!parts) return "--";
  const period = parts.hour >= 12 ? "PM" : "AM";
  const hour12 = parts.hour % 12 || 12;
  const minute = parts.minute ? `:${String(parts.minute).padStart(2, "0")}` : "";
  return `${hour12}${minute} ${period}`;
}

function formatEvidenceTimestamp(value, timezone) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || undefined,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
}

function weatherFreshnessLabel(value, nowMs, busy) {
  if (!value) {
    return busy ? "Updating… · auto 10m" : "Waiting for update · auto 10m";
  }

  const updatedMs = Date.parse(value);
  if (!Number.isFinite(updatedMs)) return "Auto-refresh every 10m";

  const minutes = Math.max(0, Math.floor((nowMs - updatedMs) / 60_000));
  if (minutes < 1) return "Updated just now · auto 10m";
  if (minutes === 1) return "Updated 1 min ago · auto 10m";
  return `Updated ${minutes} min ago · auto 10m`;
}

function riskTone(band, supported) {
  if (!supported) return "weather";
  if (["danger", "extreme_danger"].includes(band)) return "danger";
  if (["caution", "extreme_caution"].includes(band)) return "caution";
  if (band === "below_caution") return "lower";
  return "pending";
}

function riskTitle(band, supported, cycle) {
  if (!supported) return "WEATHER CONTEXT";
  if (!cycle) return "HEAT RISK CHECK";
  if (band === "extreme_danger") return "EXTREME HEAT RISK";
  if (band === "danger") return "HIGH HEAT RISK";
  return String(BAND_LABEL[band] ?? "HEAT RISK").toUpperCase();
}

function guidanceForBand(band, supported, cycle, replayMode) {
  if (!supported) {
    return "Current local weather is shown for this location. FortyGuard occupational heat intelligence is available only at supported U.S. worksites.";
  }
  if (!cycle) {
    return replayMode
      ? "HeatShield is loading the verified FortyGuard Phoenix demo snapshot and will update this card when the evidence is ready."
      : "HeatShield is loading the current FortyGuard worksite scan and will update this card when the evidence is ready.";
  }
  if (["danger", "extreme_danger"].includes(band)) {
    return replayMode
      ? "The verified snapshot shows severe heat stress. Heavy outdoor work should be reduced, with hydration, recovery, and cooler-area controls prioritized."
      : "Avoid heavy outdoor work right now. Take a break, hydrate, and move to a cooler or shaded area.";
  }
  if (["caution", "extreme_caution"].includes(band)) {
    return replayMode
      ? "The verified snapshot shows elevated heat stress. Reduce intensity, schedule recovery breaks, hydrate often, and monitor workers closely."
      : "Reduce intensity, schedule frequent recovery breaks, hydrate often, and watch for heat symptoms.";
  }
  return replayMode
    ? "The verified snapshot is comparatively lower risk, but normal hydration, shade, and heat-safety controls still apply."
    : "Conditions are currently lower risk. Keep hydration, shade, and normal heat-safety controls in place.";
}

function uvLabel(value) {
  const uv = finite(value);
  if (uv === null) return "--";
  if (uv >= 11) return `${Math.round(uv)} (Extreme)`;
  if (uv >= 8) return `${Math.round(uv)} (High)`;
  if (uv >= 6) return `${Math.round(uv)} (High)`;
  if (uv >= 3) return `${Math.round(uv)} (Moderate)`;
  return `${Math.round(uv)} (Low)`;
}

function lowerHeatWindow(weather) {
  const rows = (weather?.hourly ?? []).slice(1, 8)
    .map((item) => ({
      ...item,
      score: finite(item.apparent_temperature_c ?? item.temperature_2m_c),
    }))
    .filter((item) => item.score !== null);

  if (!rows.length) return null;
  const best = rows.reduce((candidate, item) => (item.score < candidate.score ? item : candidate), rows[0]);
  return {
    label: `After ${formatTime(best.local_time)}`,
    tempF: cToF(best.apparent_temperature_c ?? best.temperature_2m_c),
  };
}

export default function TodayScreen({
  location,
  locationBusy,
  fortyGuardSupported,
  cycle,
  weather,
  weatherBusy,
  weatherUpdatedAt,
  heatmapState,
  analysisBusy,
  onAnalyze,
  onNavigate,
}) {
  const [relativeNow, setRelativeNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const locating = locationBusy && !location;
  const replayMode = Boolean(location?.analysis_datetime);
  const evidenceTimestamp = replayMode
    ? formatEvidenceTimestamp(location?.analysis_datetime, location?.timezone)
    : null;
  const weatherFreshness = weatherFreshnessLabel(
    weatherUpdatedAt,
    relativeNow,
    weatherBusy,
  );
  const env = cycle?.current_assessment?.environmental_evidence ?? {};
  const screening = cycle?.current_assessment?.screening ?? {};
  const currentWeather = weather?.current ?? {};
  const today = weather?.daily?.[0] ?? {};
  const band = screening?.band;
  const tone = locating ? "weather" : riskTone(band, fortyGuardSupported);

  const providerTempC = finite(
    env.verified_temperature_c ??
      env.temperature_c ??
      env.air_temperature_c,
  );
  const airTempF = cToF(providerTempC ?? currentWeather.temperature_2m_c);
  const feelsLikeF = cToF(
    env.apparent_temperature_c ?? currentWeather.apparent_temperature_c,
  );
  const heatIndexF = cToF(env.heat_index_c);
  const humidity = finite(
    replayMode
      ? currentWeather.relative_humidity_percent
      : env.relative_humidity_percent ??
        env.relative_humidity ??
        currentWeather.relative_humidity_percent,
  );
  const windMph = kmhToMph(currentWeather.wind_speed_kmh);
  const uv = finite(
    weather?.air_quality?.uv_index ??
      weather?.hourly?.[0]?.uv_index ??
      today.uv_index_max,
  );

  const cooler = cycle?.spatial_heat?.candidates?.[0] ?? null;
  const coolerDistanceM = cooler ? finite(cooler.straight_line_distance_m) : null;
  const coolerMiles = coolerDistanceM === null ? null : coolerDistanceM / 1609.344;
  const coolerTempF = cooler
    ? cToF(
        cooler.temperature_c ??
          cooler.verified_temperature_c ??
          cooler.average_temperature_c,
      )
    : null;
  const workWindow = lowerHeatWindow(weather);
  const mappedTileCount = finite(heatmapState?.featureCount);
  const spatialGranularity = finite(cycle?.spatial_heat?.granularity);
  const verifiedSourceDetails = [
    "FortyGuard verified replay",
    mappedTileCount !== null ? `${Math.round(mappedTileCount)} mapped tiles` : null,
    spatialGranularity !== null ? `${Math.round(spatialGranularity)} m grid` : null,
  ].filter(Boolean).join(" · ");

  const handlePrimaryAction = () => {
    if (locating) return;
    if (!fortyGuardSupported) {
      onNavigate("map");
      return;
    }
    if (cycle) {
      onNavigate("plan");
      return;
    }
    onAnalyze();
  };

  const kicker = locating
    ? "DETECTING CURRENT LOCATION"
    : replayMode && !cycle
      ? "VERIFIED HEAT RISK CHECK"
      : riskTitle(band, fortyGuardSupported, cycle);

  const heatIndexText = locating
    ? "Getting your location and current conditions…"
    : heatIndexF !== null
      ? replayMode
        ? `Heat index: ${rounded(heatIndexF)}°F · verified`
        : `Heat index: ${rounded(heatIndexF)}°F`
      : analysisBusy
        ? replayMode
          ? "Loading verified FortyGuard Phoenix evidence…"
          : "FortyGuard worksite scan is running…"
        : weatherBusy
          ? "Loading current weather conditions…"
          : cycle
            ? replayMode
              ? "Heat index is not available in the verified provider snapshot."
              : "Heat index is not available in the current provider evidence."
            : fortyGuardSupported
              ? replayMode
                ? "Verified Phoenix heat evidence is loading."
                : "Current worksite heat evidence is loading."
              : "General weather context is shown for this location.";

  const guidance = locating
    ? "Allow location access in your browser so HeatShield can automatically load conditions for your current worksite."
    : guidanceForBand(band, fortyGuardSupported, cycle, replayMode);

  return (
    <div className="hs-screen hs-home-screen-v1">
      <section className={`hs-home-risk-card tone-${tone}`}>
        <div className="hs-home-risk-main">
          <div className="hs-home-risk-heading-row">
            <div className="hs-home-risk-kicker">
              {locating || analysisBusy ? <LoaderCircle className="spinner" size={15} /> : tone === "danger" ? <AlertTriangle size={15} /> : <ShieldAlert size={15} />}
              <span>{kicker}</span>
            </div>
            {replayMode ? <span className="hs-home-evidence-pill">VERIFIED REPLAY</span> : null}
          </div>

          {replayMode && evidenceTimestamp ? (
            <div className="hs-home-evidence-time">FortyGuard evidence · {evidenceTimestamp}</div>
          ) : null}

          <div className="hs-home-temp-row">
            <div className="hs-home-temp-copy">
              <strong>{rounded(airTempF)}<sup>°F</sup></strong>
              <span>
                Feels like {rounded(feelsLikeF)}°F{replayMode && cycle ? " · verified" : ""}
              </span>
            </div>
            <div className="hs-home-thermometer" aria-hidden="true">
              <ThermometerSun size={35} />
            </div>
          </div>

          <div className="hs-home-heat-index">{heatIndexText}</div>
        </div>

        <div className="hs-home-guidance">
          <AlertTriangle size={16} />
          <span>{guidance}</span>
        </div>
      </section>

      <div className="hs-home-section-label">
        <span>{replayMode ? "LIVE WEATHER CONTEXT" : "LIVE CONDITIONS"}</span>
        <small>{weatherFreshness}</small>
      </div>

      <section className="hs-home-stat-row" aria-label={replayMode ? "Live weather context" : "Current conditions"}>
        <div>
          <Droplets size={19} />
          <span>{replayMode ? "Live humidity" : "Humidity"}</span>
          <strong>{rounded(humidity)}%</strong>
        </div>
        <div>
          <Wind size={19} />
          <span>{replayMode ? "Live wind" : "Wind"}</span>
          <strong>{rounded(windMph)} mph</strong>
        </div>
        <div>
          <SunMedium size={19} />
          <span>{replayMode ? "Live UV" : "UV Index"}</span>
          <strong>{uvLabel(uv)}</strong>
        </div>
      </section>

      <button className="hs-home-info-card hs-home-cooling" type="button" onClick={() => onNavigate("map")}>
        <span className="hs-home-info-icon"><Leaf size={23} /></span>
        <span className="hs-home-info-copy">
          <small>
            {replayMode
              ? "Verified lower-heat area"
              : cooler
                ? "Nearest lower-heat area"
                : "Lower-heat area"}
          </small>
          <strong>
            {locating
              ? "Waiting for current location"
              : coolerMiles !== null
                ? `${coolerMiles.toFixed(1)} mi away`
                : fortyGuardSupported
                  ? analysisBusy
                    ? "Comparing nearby heat…"
                    : cycle?.spatial_heat?.status === "insufficient_data"
                      ? "No mapped comparison available"
                      : "Scan to compare nearby heat"
                  : "Available at supported U.S. worksites"}
          </strong>
          {coolerTempF !== null ? (
            <em>{rounded(coolerTempF)}°F {replayMode ? "verified tile" : "candidate"}</em>
          ) : null}
        </span>
        <span className="hs-home-card-link">View on Map <ArrowRight size={14} /></span>
      </button>

      <button className="hs-home-info-card hs-home-window" type="button" onClick={() => onNavigate("plan")}>
        <span className="hs-home-info-icon"><Clock3 size={23} /></span>
        <span className="hs-home-info-copy">
          <small>{replayMode ? "Live lower-heat work window" : "Lower-heat work window today"}</small>
          <strong>{locating || weatherBusy ? "Loading current forecast…" : workWindow?.label ?? "Forecast window unavailable"}</strong>
          {workWindow?.tempF !== null && workWindow?.tempF !== undefined ? (
            <em>{replayMode ? "Live forecast · " : ""}Feels like about {rounded(workWindow.tempF)}°F</em>
          ) : null}
        </span>
        <ArrowRight className="hs-home-end-arrow" size={18} />
      </button>

      <button
        className="hs-home-ai-cta"
        type="button"
        onClick={handlePrimaryAction}
        disabled={analysisBusy || locating}
      >
        <span className="hs-home-ai-icon">
          {analysisBusy || locating ? <LoaderCircle className="spinner" size={21} /> : <Sparkles size={21} />}
        </span>
        <span>
          <strong>{cycle ? "VIEW AI RECOMMENDATION" : locating ? "FINDING YOUR LOCATION" : "WHAT SHOULD I DO?"}</strong>
          <small>
            {cycle
              ? "Open the evidence-backed work plan"
              : locating
                ? "Loading local conditions automatically"
                : fortyGuardSupported
                  ? analysisBusy
                    ? replayMode ? "Building verified recommendation" : "Building current recommendation"
                    : "Get AI Recommendation"
                  : "View available local weather context"}
          </small>
        </span>
        <ArrowRight size={20} />
      </button>

      <p className="hs-home-source-note">
        <MapPin size={13} />
        <span>
          {replayMode
            ? `${verifiedSourceDetails}. Replay stays fixed; live weather refreshes every 10 min.`
            : "FortyGuard is the primary heat-risk evidence source. Live weather refreshes every 10 min; current FortyGuard evidence refreshes on the hour."}
        </span>
      </p>
    </div>
  );
}
