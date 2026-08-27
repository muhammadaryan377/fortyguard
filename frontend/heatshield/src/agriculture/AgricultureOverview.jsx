import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Droplets,
  ExternalLink,
  Farm,
  Flame,
  Gauge,
  Home,
  Layers3,
  Leaf,
  Map as MapIcon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sprout,
  ThermometerSun,
  UsersRound,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CircleMarker, GeoJSON, MapContainer, Polygon, TileLayer, Tooltip as LeafletTooltip } from "react-leaflet";

import {
  PHOENIX_LOCATION,
  VERIFIED_SNAPSHOT_FILTER,
  extractFeatureTemperature,
  fetchEnvironmentForHeatmap,
  fetchHeatmap,
} from "../api/heatshieldApi.js";
import "./AgricultureOverview.css";

const FARM_FIELDS = [
  { id: 1, name: "North Pivot", crop: "Corn", center: [33.4516, -112.0788], polygon: [[33.4542, -112.0838], [33.4540, -112.0764], [33.4498, -112.0758], [33.4493, -112.0825]] },
  { id: 2, name: "West Bottom", crop: "Cotton", center: [33.4468, -112.0813], polygon: [[33.4490, -112.0854], [33.4488, -112.0785], [33.4444, -112.0782], [33.4440, -112.0844]] },
  { id: 3, name: "Central Block", crop: "Corn", center: [33.4491, -112.0737], polygon: [[33.4536, -112.0761], [33.4534, -112.0693], [33.4457, -112.0690], [33.4453, -112.0759]] },
  { id: 4, name: "East Field", crop: "Soybean", center: [33.4504, -112.0666], polygon: [[33.4535, -112.0690], [33.4533, -112.0630], [33.4477, -112.0631], [33.4474, -112.0687]] },
  { id: 5, name: "South 40", crop: "Wheat", center: [33.4438, -112.0710], polygon: [[33.4460, -112.0754], [33.4459, -112.0662], [33.4416, -112.0662], [33.4414, -112.0750]] },
];

const FALLBACK_TEMPS = {
  1: 37.2,
  2: 34.8,
  3: 38.4,
  4: 35.7,
  5: 33.9,
};

const HOURLY_PROFILE = [
  { time: "6 AM", value: 28.4 },
  { time: "8 AM", value: 30.2 },
  { time: "10 AM", value: 33.8 },
  { time: "12 PM", value: 36.9 },
  { time: "2 PM", value: 38.4 },
  { time: "4 PM", value: 37.6 },
  { time: "6 PM", value: 34.1 },
  { time: "8 PM", value: 31.0 },
];

const navItems = [
  [Home, "Overview", true],
  [Sprout, "Farms"],
  [MapIcon, "Fields"],
  [ThermometerSun, "Crop Heat Stress"],
  [Droplets, "Irrigation Planner"],
  [UsersRound, "Field Work Planner"],
  [Bell, "Alerts"],
];

function riskFromC(value) {
  if (!Number.isFinite(value)) return { label: "No data", tone: "neutral" };
  if (value >= 38) return { label: "Extreme", tone: "critical" };
  if (value >= 35) return { label: "High", tone: "high" };
  if (value >= 32) return { label: "Moderate", tone: "moderate" };
  return { label: "Low", tone: "low" };
}

function heatColor(value) {
  if (!Number.isFinite(value)) return "#94a3b8";
  if (value >= 39) return "#b91c1c";
  if (value >= 37) return "#ef4444";
  if (value >= 35) return "#f97316";
  if (value >= 33) return "#eab308";
  if (value >= 30) return "#65a30d";
  return "#0f9f8f";
}

function round(value, digits = 1) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function featureCentroid(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;
  const points = [];
  const collect = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      points.push(value);
      return;
    }
    value.forEach(collect);
  };
  collect(geometry.coordinates);
  if (!points.length) return null;
  const total = points.reduce((acc, [lng, lat]) => ({ lat: acc.lat + lat, lng: acc.lng + lng }), { lat: 0, lng: 0 });
  return [total.lat / points.length, total.lng / points.length];
}

function distanceSq(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function buildFieldTemperatures(mapData) {
  const buckets = Object.fromEntries(FARM_FIELDS.map((field) => [field.id, []]));
  for (const feature of mapData?.features ?? []) {
    const temperature = extractFeatureTemperature(feature?.properties ?? {})?.value;
    const center = featureCentroid(feature);
    if (!Number.isFinite(temperature) || !center) continue;
    const nearest = FARM_FIELDS.reduce((best, field) => {
      const score = distanceSq(center, field.center);
      return !best || score < best.score ? { field, score } : best;
    }, null);
    if (nearest) buckets[nearest.field.id].push(temperature);
  }

  return Object.fromEntries(FARM_FIELDS.map((field) => {
    const values = buckets[field.id];
    const value = values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : FALLBACK_TEMPS[field.id];
    return [field.id, round(value)];
  }));
}

function Metric({ icon: Icon, label, value, helper, tone = "default" }) {
  return (
    <div className={`agri-metric agri-metric--${tone}`}>
      <div className="agri-metric__icon"><Icon size={18} strokeWidth={2} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {helper ? <small>{helper}</small> : null}
      </div>
    </div>
  );
}

export default function AgricultureOverview() {
  const [heatmap, setHeatmap] = useState(null);
  const [environment, setEnvironment] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const loadEvidence = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await fetchHeatmap({
        latitude: PHOENIX_LOCATION.latitude,
        longitude: PHOENIX_LOCATION.longitude,
        radiusMeters: 900,
        granularity: 100,
        dateTime: VERIFIED_SNAPSHOT_FILTER,
      });
      setHeatmap(result);
      try {
        const env = await fetchEnvironmentForHeatmap(result, PHOENIX_LOCATION);
        setEnvironment(env);
      } catch {
        setEnvironment(null);
      }
      setUpdatedAt(new Date());
    } catch (nextError) {
      setError(nextError?.message || "FortyGuard evidence could not be loaded.");
      setHeatmap(null);
      setEnvironment(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadEvidence();
  }, []);

  const fieldTemperatures = useMemo(
    () => (heatmap?.mapData ? buildFieldTemperatures(heatmap.mapData) : FALLBACK_TEMPS),
    [heatmap],
  );

  const rankedFields = useMemo(() => FARM_FIELDS
    .map((field) => ({ ...field, temperature: fieldTemperatures[field.id], risk: riskFromC(fieldTemperatures[field.id]) }))
    .sort((a, b) => b.temperature - a.temperature), [fieldTemperatures]);

  const allTemperatures = useMemo(() => {
    const values = (heatmap?.mapData?.features ?? [])
      .map((feature) => extractFeatureTemperature(feature?.properties ?? {})?.value)
      .filter(Number.isFinite);
    return values.length ? values : Object.values(FALLBACK_TEMPS);
  }, [heatmap]);

  const maxTemp = round(Math.max(...allTemperatures));
  const meanTemp = round(allTemperatures.reduce((sum, value) => sum + value, 0) / allTemperatures.length);
  const overallRisk = riskFromC(maxTemp);
  const hottest = rankedFields[0];
  const heatIndex = environment?.condition?.heat_index ?? environment?.condition?.heat_index_c ?? null;
  const humidity = environment?.condition?.relative_humidity ?? environment?.condition?.relative_humidity_percent ?? null;

  const statusCopy = busy
    ? "Loading verified FortyGuard evidence…"
    : heatmap
      ? `Verified replay · ${heatmap.featureCount} thermal tiles`
      : "Preview fallback · API evidence unavailable";

  return (
    <div className="agri-app">
      <aside className="agri-sidebar">
        <div className="agri-brand">
          <div className="agri-brand__mark"><ShieldCheck size={24} /></div>
          <div><b>Heat<span>Shield</span></b><small>AGRICULTURE</small></div>
        </div>
        <nav>
          {navItems.map(([Icon, label, active]) => (
            <button key={label} className={active ? "active" : ""} type="button">
              <Icon size={20} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="agri-sidebar__footer">
          <div className="agri-core-card"><div className="agri-core-avatar">HS</div><div><strong>HeatShield Agriculture</strong><small>FortyGuard Core</small></div><ChevronDown size={16} /></div>
          <button type="button" className="agri-help"><AlertTriangle size={18} /> Help & Support</button>
        </div>
      </aside>

      <main className="agri-main">
        <header className="agri-header">
          <div>
            <h1>Agriculture Heat Intelligence</h1>
            <p>FortyGuard-powered thermal intelligence for farms, fields, crop stress, irrigation timing, and field work planning.</p>
          </div>
          <div className="agri-header__actions">
            <div className="agri-intel-badge"><i /><span>INTELLIGENCE CORE<strong>FortyGuard</strong></span></div>
            <button type="button" className="agri-outline-button">All Modules</button>
          </div>
        </header>

        <section className="agri-content">
          <div className="agri-toolbar">
            <button type="button"><Farm size={17} /><span><small>Farm</small>Valley View Farm</span><ChevronDown size={16} /></button>
            <button type="button"><CalendarDays size={17} /><span><small>Evidence date</small>15 Jul 2024 · 14:00</span><ChevronDown size={16} /></button>
            <button type="button"><Gauge size={17} /><span><small>Mode</small>Verified replay</span><ChevronDown size={16} /></button>
            <div className="agri-evidence-state"><ShieldCheck size={20} /><div><strong>FortyGuard Core</strong><small>{statusCopy}</small></div><button type="button" title="Refresh evidence" onClick={loadEvidence} disabled={busy}><RefreshCw size={16} className={busy ? "spin" : ""} /></button></div>
          </div>

          {error ? <div className="agri-warning"><AlertTriangle size={17} /><span>{error} The screen remains usable with clearly labeled preview values.</span></div> : null}

          <section className="agri-hero-grid">
            <article className="agri-card agri-map-card">
              <div className="agri-card__heading"><div><h2>Farm Thermal Map</h2><p>Field boundaries + FortyGuard thermal evidence</p></div><span className="agri-live-dot">{heatmap ? "VERIFIED" : "PREVIEW"}</span></div>
              <div className="agri-map-wrap">
                <MapContainer center={[PHOENIX_LOCATION.latitude, PHOENIX_LOCATION.longitude]} zoom={15} scrollWheelZoom className="agri-map">
                  <TileLayer attribution="Tiles © Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                  {heatmap?.mapData ? <GeoJSON key={heatmap.activityId} data={heatmap.mapData} style={(feature) => {
                    const value = extractFeatureTemperature(feature?.properties ?? {})?.value;
                    return { color: heatColor(value), weight: 0.4, fillColor: heatColor(value), fillOpacity: 0.46 };
                  }} /> : null}
                  {FARM_FIELDS.map((field) => (
                    <Polygon key={field.id} positions={field.polygon} pathOptions={{ color: "#ffffff", weight: 2, fillOpacity: 0.04 }}>
                      <LeafletTooltip sticky>{field.name} · {field.crop} · {fieldTemperatures[field.id]}°C</LeafletTooltip>
                    </Polygon>
                  ))}
                  {rankedFields.slice(0, 3).map((field) => (
                    <CircleMarker key={`hot-${field.id}`} center={field.center} radius={11} pathOptions={{ color: "#fff", weight: 2, fillColor: heatColor(field.temperature), fillOpacity: 1 }}>
                      <LeafletTooltip direction="top" offset={[0, -10]}>{field.name}: {field.temperature}°C</LeafletTooltip>
                    </CircleMarker>
                  ))}
                </MapContainer>
                <div className="agri-map-legend"><span>Cooler</span><i /><span>Hotter</span></div>
                <div className="agri-map-caption"><Layers3 size={15} /> Thermal tiles are FortyGuard evidence when verified; white outlines are HeatShield farm context.</div>
              </div>
            </article>

            <article className="agri-card agri-status-card">
              <div className="agri-card__heading"><div><h2>Farm Status</h2><p>{updatedAt ? `Refreshed ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Evidence pending"}</p></div><ShieldCheck size={20} /></div>
              <div className="agri-status-grid">
                <Metric icon={ShieldCheck} label="Overall Heat Risk" value={overallRisk.label} helper={`Mean ${meanTemp}°C`} tone={overallRisk.tone} />
                <Metric icon={Flame} label="Hottest Field" value={hottest?.name ?? "—"} helper={hottest ? `${hottest.temperature}°C · ${hottest.crop}` : "No field data"} tone="high" />
                <Metric icon={ThermometerSun} label="Peak Temperature" value={maxTemp ? `${maxTemp}°C` : "—"} helper="Thermal evidence maximum" tone="critical" />
                <Metric icon={Clock3} label="Peak Exposure Window" value="13:00–17:00" helper="Planning estimate" tone="moderate" />
                <Metric icon={Droplets} label="Irrigation Priority" value={overallRisk.tone === "critical" ? "Urgent review" : "High"} helper="Inspect hottest zones first" tone="high" />
                <Metric icon={UsersRound} label="Field Work Window" value="06:00–10:30" helper="Lower-heat work period" tone="low" />
              </div>
              <div className="agri-status-footer"><Bell size={18} /><div><strong>3 operational watch items</strong><small>2 heat · 1 work-window</small></div><button type="button">View alerts <ExternalLink size={14} /></button></div>
            </article>
          </section>

          <article className="agri-agent-brief">
            <div className="agri-agent-brief__icon"><Sparkles size={20} /></div>
            <div className="agri-agent-brief__copy"><strong>Agent Brief</strong><p>{hottest?.name ?? "The hottest field"} is the first field to inspect. Prioritize field checks before peak afternoon heat, review irrigation readiness, and move strenuous field work into the morning window. HeatShield keeps recommendations separate from the underlying FortyGuard evidence.</p></div>
            <div className="agri-evidence-chips"><span><Layers3 size={14} /> Heatmap</span><span><ThermometerSun size={14} /> Environmental</span><span><Clock3 size={14} /> Historical</span><span><Leaf size={14} /> Farm context</span></div>
            <div className="agri-confidence"><CheckCircle2 size={16} /> {heatmap ? "Evidence verified" : "Preview mode"}</div>
          </article>

          <section className="agri-action-row">
            <article className="agri-action-card"><div><Leaf size={20} /><span className="tone-high">HIGH</span></div><h3>Crop Stress</h3><p>{rankedFields.filter((field) => field.temperature >= 35).length} fields need closer heat-stress review.</p><button type="button">Review crop stress →</button></article>
            <article className="agri-action-card"><div><Droplets size={20} /><span className="tone-high">HIGH</span></div><h3>Irrigation Priority</h3><p>Inspect irrigation readiness in the hottest field zones first.</p><button type="button">Plan irrigation →</button></article>
            <article className="agri-action-card"><div><UsersRound size={20} /><span className="tone-moderate">LIMITED</span></div><h3>Field Work Windows</h3><p>Morning is preferred; afternoon exposure rises sharply.</p><button type="button">View work plan →</button></article>
            <article className="agri-action-card"><div><Bell size={20} /><span className="tone-critical">3 WATCH</span></div><h3>Alerts</h3><p>Heat persistence and field-work timing need monitoring.</p><button type="button">View alerts →</button></article>
          </section>

          <div className="agri-section-title"><h2>Why this matters today</h2><p>Evidence translated into farm-level operational context.</p></div>
          <section className="agri-analytics-grid">
            <article className="agri-card agri-threshold-card">
              <div className="agri-card__heading"><h3>Threshold Exceedance</h3><span>% of thermal tiles</span></div>
              {[{ label: "Extreme ≥38°C", min: 38, tone: "critical" }, { label: "High 35–37.9°C", min: 35, max: 38, tone: "high" }, { label: "Moderate 32–34.9°C", min: 32, max: 35, tone: "moderate" }, { label: "Low <32°C", max: 32, tone: "low" }].map((band) => {
                const count = allTemperatures.filter((value) => (band.min == null || value >= band.min) && (band.max == null || value < band.max)).length;
                const pct = Math.round((count / allTemperatures.length) * 100);
                return <div className="agri-threshold-row" key={band.label}><span>{band.label}</span><div><i className={`bar-${band.tone}`} style={{ width: `${Math.max(pct, 3)}%` }} /></div><strong>{pct}%</strong></div>;
              })}
              <small>{heatmap ? `${heatmap.featureCount} verified heat tiles analyzed` : "Preview values shown"}</small>
            </article>

            <article className="agri-card agri-ranking-card">
              <div className="agri-card__heading"><h3>Hottest Fields</h3><span>Top 5</span></div>
              <div className="agri-ranking-head"><span>Field</span><span>Temp</span><span>Risk</span></div>
              {rankedFields.map((field, index) => <div className="agri-ranking-row" key={field.id}><span><b>{index + 1}</b>{field.name}<small>{field.crop}</small></span><strong>{field.temperature}°C</strong><em className={`risk-${field.risk.tone}`}>{field.risk.label}</em></div>)}
            </article>

            <article className="agri-card agri-chart-card">
              <div className="agri-card__heading"><div><h3>Hourly Heat Exposure</h3><p>Planning profile · not provider forecast</p></div><ThermometerSun size={18} /></div>
              <div className="agri-chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={HOURLY_PROFILE} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <defs><linearGradient id="agriArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0f8f85" stopOpacity={0.3}/><stop offset="95%" stopColor="#0f8f85" stopOpacity={0.02}/></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis domain={[26, 40]} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} unit="°" />
                    <Tooltip formatter={(value) => [`${value}°C`, "Temperature"]} />
                    <Area type="monotone" dataKey="value" stroke="#0f8f85" strokeWidth={2.5} fill="url(#agriArea)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="agri-chart-stats"><span><small>Peak</small><strong>38.4°C</strong></span><span><small>High-risk window</small><strong>13:00–17:00</strong></span><span><small>Heat index</small><strong>{Number.isFinite(Number(heatIndex)) ? `${round(Number(heatIndex))}°C` : "—"}</strong></span></div>
            </article>

            <article className="agri-card agri-outlook-card">
              <div className="agri-card__heading"><h3>Evidence Snapshot</h3><ShieldCheck size={18} /></div>
              <div className="agri-evidence-line"><span>Heatmap</span><strong>{heatmap ? `${heatmap.featureCount} tiles` : "Fallback"}</strong></div>
              <div className="agri-evidence-line"><span>Activity ID</span><strong className="mono">{heatmap?.activityId ? `${heatmap.activityId.slice(0, 8)}…` : "—"}</strong></div>
              <div className="agri-evidence-line"><span>Relative humidity</span><strong>{Number.isFinite(Number(humidity)) ? `${round(Number(humidity))}%` : "—"}</strong></div>
              <div className="agri-evidence-line"><span>Mean surface temp</span><strong>{meanTemp}°C</strong></div>
              <div className="agri-evidence-line"><span>Source status</span><em className={heatmap ? "risk-low" : "risk-moderate"}>{heatmap ? "Verified" : "Preview"}</em></div>
              <button type="button" onClick={loadEvidence} disabled={busy}>Refresh FortyGuard evidence <RefreshCw size={14} /></button>
            </article>
          </section>
        </section>
      </main>
    </div>
  );
}
