import {
  ArrowRight,
  ClipboardList,
  Droplets,
  MapPinned,
  SunMedium,
  Sunrise,
  Sunset,
  Users,
  Wind,
  Zap,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { BAND_LABEL, finite, metric } from "../productUtils.js";

function formatClock(value) {
  if (!value) return "--";
  const text = String(value);
  const time = text.includes("T") ? text.split("T")[1] : text;
  return time?.slice(0, 5) || "--";
}

function attentionCount(work, cycle) {
  let count = 0;
  if (!work?.acclimatized) count += 1;
  if (["heavy", "very_heavy"].includes(work?.workload)) count += 1;
  if (work?.directSun && cycle?.current_assessment?.screening?.band && cycle.current_assessment.screening.band !== "below_caution") count += 1;
  return count;
}

function TimelineCard({ weather, cycle }) {
  const hourly = (weather?.hourly ?? []).slice(0, 7);
  const chartData = hourly.map((item, index) => ({
    label: index === 0 ? "Now" : formatClock(item.local_time),
    temp: finite(item.temperature_2m_c),
  })).filter((item) => item.temp !== null);

  const providerPoints = cycle?.heat_outlook?.points ?? [];
  const hottest = providerPoints
    .filter((point) => point.status === "available" && finite(point.temperature_c) !== null)
    .sort((a, b) => b.temperature_c - a.temperature_c)[0];

  return (
    <article className="hs-feature-card hs-timeline-card">
      <div className="hs-card-heading">
        <div><span>Today’s heat timeline</span><strong>{hottest ? `Peak sample ${metric(hottest.temperature_c)}°C` : "Weather context"}</strong></div>
      </div>
      <div className="hs-mini-chart">
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
              <defs>
                <linearGradient id="hsHeatGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" axisLine={false} tickLine={false} interval="preserveStartEnd" tick={{ fontSize: 10 }} />
              <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}°C`, "Air temp"]} />
              <Area dataKey="temp" type="monotone" stroke="currentColor" strokeWidth={2.4} fill="url(#hsHeatGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div className="hs-empty-mini">Hourly context will appear when available.</div>}
      </div>
    </article>
  );
}

export default function TodayScreen({
  location,
  cycle,
  weather,
  weatherBusy,
  work,
  analysisBusy,
  onAnalyze,
  onNavigate,
}) {
  const env = cycle?.current_assessment?.environmental_evidence;
  const screening = cycle?.current_assessment?.screening;
  const currentWeather = weather?.current ?? {};
  const today = weather?.daily?.[0] ?? {};
  const primaryTemp = finite(env?.temperature_c) ?? finite(currentWeather.temperature_2m_c);
  const displayTemp = primaryTemp === null ? "--" : Math.round(primaryTemp);
  const cooler = cycle?.spatial_heat?.candidates?.[0];
  const attention = attentionCount(work, cycle);
  const band = BAND_LABEL[screening?.band] ?? (cycle ? "Heat screening unavailable" : "Run a heat check");

  return (
    <div className="hs-screen hs-today-screen">
      <section className="hs-hero-card">
        <div className="hs-hero-topline">
          <span>{cycle ? "FortyGuard heat" : weatherBusy ? "Loading worksite context" : "Worksite preview"}</span>
          <span>{location?.timezone}</span>
        </div>
        <div className="hs-hero-main">
          <div className="hs-big-temp"><strong>{displayTemp}°</strong><span>{cycle ? "Current worksite" : "Air temperature"}</span></div>
          <div className="hs-risk-pill">
            <SunMedium size={21} />
            <div><strong>{band}</strong><span>{cycle ? `Heat Index ${metric(env?.heat_index_c)}°C` : "HeatShield will confirm with FortyGuard"}</span></div>
          </div>
        </div>
        <p className="hs-hero-summary">
          {cycle
            ? cycle.agent_decision?.reasoning_summary?.thermal_interpretation || "Current heat evidence is ready for an operational plan."
            : "Describe the work, then run a heat check for a provider-backed plan."}
        </p>
        <div className="hs-hero-stats">
          <div><Droplets size={18} /><strong>{metric(env?.relative_humidity ?? currentWeather.relative_humidity_percent, 0)}%</strong><span>Humidity</span></div>
          <div><Wind size={18} /><strong>{metric(currentWeather.wind_speed_kmh, 0)} km/h</strong><span>Wind</span></div>
          <div><Sunrise size={18} /><strong>{formatClock(today.sunrise)}</strong><span>Sunrise</span></div>
          <div><Sunset size={18} /><strong>{formatClock(today.sunset)}</strong><span>Sunset</span></div>
        </div>
      </section>

      {!cycle ? (
        <button className="hs-primary-cta" type="button" onClick={onAnalyze} disabled={analysisBusy}>
          <Zap size={19} />
          <span><strong>{analysisBusy ? "Building heat plan…" : "Check heat & build plan"}</strong><small>FortyGuard heat + nearby options + operational agent plan</small></span>
          <ArrowRight size={18} />
        </button>
      ) : null}

      <section className="hs-feature-grid">
        <button className="hs-feature-card hs-feature-blue" type="button" onClick={() => onNavigate("plan")}>
          <span className="hs-feature-icon"><ClipboardList size={21} /></span>
          <div><strong>{cycle ? "Review safer work plan" : "Build safer shift plan"}</strong><p>{cycle ? `${cycle.agent_decision?.actions?.length ?? 0} recommended controls ready for review.` : "Set workload, PPE, duration and sun exposure."}</p><b>{cycle ? "Review plan" : "Set work conditions"} <ArrowRight size={14} /></b></div>
        </button>

        <button className="hs-feature-card hs-feature-green" type="button" onClick={() => onNavigate("map")}>
          <span className="hs-feature-icon"><MapPinned size={21} /></span>
          <div><strong>Nearby recovery option</strong><p>{cooler ? `${metric(cooler.cooler_by_c)}°C cooler provider tile about ${Math.round(cooler.straight_line_distance_m)} m away.` : "Run a heat check to compare nearby FortyGuard heat cells."}</p><b>View map <ArrowRight size={14} /></b></div>
        </button>

        <button className="hs-feature-card hs-feature-warm" type="button" onClick={() => onNavigate("team")}>
          <span className="hs-feature-icon"><Users size={21} /></span>
          <div><strong>Worker conditions</strong><p>{attention ? `${attention} current work factor${attention === 1 ? "" : "s"} deserve extra attention.` : "Current worker setup has no additional attention flags."}</p><b>Review worker <ArrowRight size={14} /></b></div>
        </button>

        <TimelineCard weather={weather} cycle={cycle} />
      </section>

      <div className="hs-source-note">FortyGuard controls heat evidence. Weather context is supporting information only.</div>
    </div>
  );
}
