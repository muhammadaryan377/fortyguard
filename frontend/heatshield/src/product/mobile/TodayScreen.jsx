import { useMemo } from "react";
import { ChevronRight, Cloud, CloudRain, Droplets, Info, LoaderCircle, MapPin, Pencil, ShieldCheck, Sun, Thermometer, Users as UsersIcon, Wind } from "lucide-react";
import { ACTION_COPY, BAND_LABEL, finite, humanize } from "../productUtils.js";
import { loadCrewMap, loadSelectedSiteId, loadSites } from "./planWorkspace.js";

const cToF = (value) => finite(value) === null ? null : (value * 9) / 5 + 32;
const kmhToMph = (value) => finite(value) === null ? null : value * 0.621371;
const shown = (value) => finite(value) === null ? "--" : String(Math.round(value));

function timezoneLabel(location) {
  if (!location?.timezone) return "Timezone unavailable";
  try {
    const parts = (kind) => new Intl.DateTimeFormat("en-US", { timeZone: location.timezone, timeZoneName: kind }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
    return `${parts("short")} (${parts("longOffset")?.replace("GMT", "UTC")})`;
  } catch { return location.timezone; }
}
function localHour(value) { const match = String(value ?? "").match(/T(\d{2}):(\d{2})/); return match ? Number(match[1]) + Number(match[2]) / 60 : null; }
function hourLabel(value) { const hour = localHour(value); if (hour === null) return "--"; const integer = Math.floor(hour); return `${integer % 12 || 12} ${integer >= 12 ? "PM" : "AM"}`; }
function currentSiteHour(timezone) { try { return Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(new Date())); } catch { return new Date().getHours(); } }
function WeatherIcon({ condition }) { const text = String(condition ?? "").toLowerCase(); return text.includes("rain") || text.includes("drizzle") ? <CloudRain /> : text && !text.includes("clear") ? <Cloud /> : <Sun />; }
function uvLabel(value) { if (finite(value) === null) return "--"; return `${Math.round(value)} (${value >= 11 ? "Extreme" : value >= 6 ? "High" : value >= 3 ? "Moderate" : "Low"})`; }
function timelineTone(item) { const value = cToF(item?.apparent_temperature_c ?? item?.temperature_2m_c); return value === null ? "unknown" : value >= 103 ? "extreme" : value >= 90 ? "high" : value >= 80 ? "moderate" : "lower"; }
function guidance(action, band, supported) {
  if (action?.action_type && ACTION_COPY[action.action_type]) return ACTION_COPY[action.action_type].title;
  if (!supported) return "Occupational heat intelligence is unavailable for this location.";
  if (["danger", "extreme_danger"].includes(band)) return "Stop strenuous work and recover in a cool, shaded area.";
  if (["caution", "extreme_caution"].includes(band)) return "Stay hydrated and take breaks in shaded areas.";
  return "Keep water available and continue normal heat-safety checks.";
}

export default function TodayScreen({ location, locationBusy, fortyGuardSupported, cycle, weather, weatherBusy, analysisBusy, operationBusy, work, onRefresh, onAnalyze, onNavigate }) {
  const replay = Boolean(location?.analysis_datetime);
  const env = cycle?.current_assessment?.environmental_evidence ?? {};
  const band = cycle?.current_assessment?.screening?.band;
  const current = weather?.current ?? {};
  const providerTempF = cToF(env.verified_temperature_c ?? env.temperature_c ?? env.air_temperature_c);
  const weatherTempF = cToF(current.temperature_2m_c);
  const mainTempF = providerTempF ?? weatherTempF;
  const feelsF = cToF(env.apparent_temperature_c ?? current.apparent_temperature_c);
  const heatIndexF = cToF(env.heat_index_c);
  const humidity = finite(env.relative_humidity_percent ?? env.relative_humidity ?? current.relative_humidity_percent);
  const wind = kmhToMph(current.wind_speed_kmh);
  const uv = finite(weather?.air_quality?.uv_index ?? weather?.hourly?.[0]?.uv_index ?? weather?.daily?.[0]?.uv_index_max);
  const actions = cycle?.agent_decision?.actions ?? [];
  const action = actions.find((item) => item.status === "proposed") ?? actions[0] ?? null;
  const actionCopy = action ? ACTION_COPY[action.action_type] : null;
  const savedWorker = useMemo(() => { const sites = loadSites(location); const siteId = loadSelectedSiteId(sites); return (loadCrewMap()[siteId] ?? [])[0] ?? null; }, [location]);
  const worker = cycle?.current_assessment?.worker_context ?? {};
  const task = cycle?.current_assessment?.task_context ?? {};
  const hasRealWorker = Boolean(savedWorker || worker.display_name || worker.name || worker.worker_name || (worker.worker_id && worker.worker_id !== "WORKER-01"));
  const displayName = savedWorker?.name || savedWorker?.workerId || (hasRealWorker ? (worker.display_name || worker.name || worker.worker_name || worker.worker_id) : null);
  const taskName = savedWorker?.currentTask || task.task_name || work?.taskName || "Task not configured";
  const initials = displayName ? displayName.split(/[\s-]+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() : "--";
  const riskLabel = BAND_LABEL[band] ?? (analysisBusy ? "Checking" : "Unavailable");
  const refreshBusy = analysisBusy || operationBusy === "recheck";
  const timeline = useMemo(() => (weather?.hourly ?? []).slice(0, 6), [weather?.hourly]);
  const nowHour = currentSiteHour(location?.timezone);
  const currentIndex = timeline.reduce((best, item, index) => { const hour = localHour(item.local_time); return hour !== null && (best.index < 0 || Math.abs(hour - nowHour) < best.distance) ? { index, distance: Math.abs(hour - nowHour) } : best; }, { index: -1, distance: Infinity }).index;
  const locationName = location?.site_name || location?.name || location?.city || (locationBusy ? "Finding location…" : "Select worksite");
  const refresh = () => cycle?.cycle_id ? onRefresh?.() : onAnalyze?.();

  return <div className="hs-screen hs-today-overview">
    <button className="hs-today-location" type="button" onClick={() => onNavigate("map")}>
      <span className="hs-location-pin"><MapPin/></span><span className="hs-location-copy"><strong>{locationName}</strong><small>{timezoneLabel(location)}</small><em><MapPin/> {location?.display_name || [location?.city, location?.state, location?.country].filter(Boolean).join(", ")}</em></span><span className="hs-change-location">Change location <Pencil/></span>
      <span className="hs-current-weather">{weatherBusy && !weather ? <LoaderCircle className="spinner" /> : <WeatherIcon condition={current.condition} />}<span><strong>{shown(weatherTempF)}°F</strong><small>{current.condition || (weatherBusy ? "Loading…" : "Weather unavailable")}</small></span></span>
    </button>
    <section className="hs-overview-card">
      <div className="hs-card-title"><h1>Heat Risk Overview</h1><span>Current Conditions</span></div>{replay ? <span className="hs-replay-badge">VERIFIED REPLAY</span> : null}
      <div className="hs-risk-layout">
        <div className={`hs-risk-gauge risk-${band || "unknown"}`}><svg viewBox="0 0 140 92" aria-hidden="true"><path className="track" d="M15 78a55 55 0 0 1 110 0"/><path className="value" d="M15 78a55 55 0 0 1 110 0"/></svg><div><strong>{shown(mainTempF)}<sup>°F</sup></strong><b>{riskLabel}</b><span>Feels like {shown(feelsF)}°F</span></div></div>
        <dl className="hs-risk-metrics"><div><dt><Droplets/>Humidity</dt><dd>{shown(humidity)}{humidity === null ? "" : "%"}</dd></div><div><dt><Thermometer/>Heat Index</dt><dd>{shown(heatIndexF)}{heatIndexF === null ? "" : "°F"}</dd></div><div><dt><Wind/>Wind</dt><dd>{shown(wind)}{wind === null ? "" : " mph"}</dd></div><div><dt><Sun/>UV Index</dt><dd>{uvLabel(uv)}</dd></div></dl>
      </div>
      <div className="hs-safety-strip"><Info/>{guidance(action, band, fortyGuardSupported)}</div>
      {!fortyGuardSupported ? <p className="hs-source-warning">FortyGuard occupational heat intelligence is currently available for supported U.S. worksites. Weather shown is secondary context.</p> : null}
    </section>
    <section className="hs-compact-card hs-timeline-card-v1"><div className="hs-card-title"><h2>Today&apos;s Timeline</h2></div>{timeline.length ? <><div className="hs-hourly-grid">{timeline.map((item,index) => <div key={item.local_time || index} className={index === currentIndex ? "current" : ""}><span>{hourLabel(item.local_time)}</span><strong>{shown(cToF(item.temperature_2m_c))}°F</strong></div>)}</div><div className="hs-risk-bar" aria-label="Generic hourly weather heat context">{timeline.map((item,index) => <i key={item.local_time || index} className={timelineTone(item)}/>)}</div><div className="hs-timeline-legend-v1"><span><i className="lower"/>Lower Risk</span><span><i className="moderate"/>Moderate</span><span><i className="high"/>High Risk</span><span><i className="extreme"/>Extreme</span></div></> : <p className="hs-empty-line">{weatherBusy ? "Loading hourly forecast…" : "Hourly forecast unavailable"}</p>}</section>
    <section className="hs-compact-card hs-workers-panel"><div className="hs-card-title hs-panel-heading"><h2>Active Workers</h2>{hasRealWorker ? <button type="button" onClick={() => onNavigate("team")}>Check all workers</button> : null}</div>{hasRealWorker ? <button className="hs-detail-row" type="button" onClick={() => onNavigate("team")}><span className="hs-worker-avatar">{initials}</span><span className="hs-detail-copy"><strong>{displayName}</strong><small>{taskName}</small></span><span className={`hs-worker-badge risk-${band || "unknown"}`}>{riskLabel}</span><ChevronRight/></button> : <div className="hs-worker-empty"><UsersIcon/><strong>No active workers yet</strong><span>Workers will appear here after they are added to this worksite.</span><button type="button" onClick={() => onNavigate("team")}>Go to Team</button></div>}</section>
    <section className="hs-compact-card hs-plans-panel"><div className="hs-card-title hs-panel-heading"><h2>Worker Plans</h2>{hasRealWorker && action ? <button type="button" onClick={() => onNavigate("plan")}>View all worker plans</button> : null}</div>{hasRealWorker && action ? <button className="hs-detail-row" type="button" onClick={() => onNavigate("plan")}><span className="hs-action-icon"><ShieldCheck/></span><span className="hs-detail-copy"><strong>{actionCopy?.title || humanize(action.action_type)}</strong><small>{action.status === "proposed" ? "Proposed · supervisor review required" : `${humanize(action.status)} action`}</small></span><ChevronRight/></button> : <div className="hs-worker-empty"><ShieldCheck/><strong>No worker plans yet</strong><span>Evidence-backed plans will appear after a worker is added and analyzed.</span></div>}</section>
    <button className={`hs-screen-refresh ${refreshBusy ? "busy" : ""}`} type="button" onClick={refresh} disabled={refreshBusy}>{refreshBusy ? "Refreshing current evidence…" : "Refresh current evidence"}</button>
  </div>;
}
