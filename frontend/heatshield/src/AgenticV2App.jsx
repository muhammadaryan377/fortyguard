import { useCallback, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Droplets,
  Flame,
  Gauge,
  Hexagon,
  LoaderCircle,
  MapPinned,
  Radar,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  SunMedium,
  ThermometerSun,
  Wind,
  Zap,
} from "lucide-react";

import {
  fetchHeatmap,
  getCurrentPhoenixDateTimeFilter,
  parseLocationInput,
  PHOENIX_LOCATION,
  VERIFIED_REPLAY_DATETIME,
  VERIFIED_SNAPSHOT_FILTER,
} from "./api/heatshieldApi.js";
import { fetchAgenticCycle } from "./api/agenticApi.js";
import LiveHeatMap from "./components/map/LiveHeatMap.jsx";
import AgentMissionControl from "./components/agent/AgentMissionControl.jsx";

import "./App.css";
import "./AgenticV2App.css";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metric(value, digits = 1) {
  const number = finite(value);
  return number === null ? "--" : number.toFixed(digits);
}

function humanize(value) {
  if (!value) return "Unavailable";
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function bandLabel(band) {
  return {
    below_caution: "Below Caution",
    caution: "Caution",
    extreme_caution: "Extreme Caution",
    danger: "Danger",
    extreme_danger: "Extreme Danger",
  }[band] ?? "Unavailable";
}

function Brand({ state }) {
  return (
    <aside className="sidebar v2-sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Shield size={39} strokeWidth={1.8} />
          <Flame className="brand-flame" size={18} fill="currentColor" />
        </div>
        <div>
          <div className="brand-name"><span>Heat</span>Shield</div>
          <div className="brand-subtitle">Agentic Heat Intelligence</div>
        </div>
      </div>

      <div className="v2-nav-block">
        {["Command Center", "Thermal Evidence", "Spatial Intelligence", "Shift Optimizer", "Agent Actions", "Verification Loop"].map((label, index) => (
          <div key={label} className={`nav-item ${index === 0 ? "active" : ""}`}>
            {index === 0 ? <BrainCircuit size={18} /> : <CheckCircle2 size={17} />}
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="provider-card">
          <div className="provider-icon"><Hexagon size={30} /><span /></div>
          <div><small>Evidence provider</small><strong>FortyGuard</strong></div>
        </div>
        <div className="agent-provider-card">
          <BrainCircuit size={19} />
          <div><small>Bounded decision model</small><strong>DeepSeek + server firewall</strong></div>
        </div>
        <div className="system-card">
          <strong>Closed-loop status</strong>
          <div className={`system-state system-${state}`}>
            <span className="status-dot" />
            {state === "loading" ? "Analysis running" : state === "connected" ? "Agent cycle connected" : state === "replay" ? "Historical replay" : state === "error" ? "Needs attention" : "Ready"}
          </div>
        </div>
      </div>
    </aside>
  );
}

function MetricCard({ title, value, unit, detail, icon: Icon, tone = "blue" }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-topline"><span className="metric-heading">{title}</span><span className="provider-mini">FG</span></div>
      <div className="metric-body">
        <div>
          <div className="metric-value">{value}{value !== "--" ? <span>{unit}</span> : null}</div>
          <div className="metric-detail">{detail}</div>
        </div>
        <div className={`metric-icon icon-${tone}`}><Icon size={25} /></div>
      </div>
    </article>
  );
}

function ThermalPanel({ cycle }) {
  const assessment = cycle?.current_assessment;
  const env = assessment?.environmental_evidence;
  const screening = assessment?.screening;
  const reasoning = cycle?.agent_decision?.reasoning_summary;
  return (
    <section className="panel v2-thermal-panel">
      <div className="panel-title-row">
        <div><div className="section-eyebrow">ASSESS</div><h2>Thermal Evidence Engine</h2></div>
        <ShieldCheck size={22} />
      </div>
      {!cycle ? (
        <div className="v2-empty"><Radar size={30} /><strong>Awaiting evidence</strong><span>Analyze a Phoenix location to start the provider-backed thermal cycle.</span></div>
      ) : (
        <>
          <div className="v2-risk-banner">
            <div><small>Heat-index screening</small><strong>{bandLabel(screening?.band)}</strong></div>
            <div><small>Evidence quality</small><strong>{humanize(assessment?.data_quality)}</strong></div>
            <div><small>Agent urgency</small><strong>{humanize(reasoning?.urgency)}</strong></div>
          </div>
          <p className="v2-thermal-copy">{reasoning?.thermal_interpretation ?? assessment?.explanations?.[0] ?? "Deterministic assessment complete."}</p>
          <div className="v2-science-grid">
            <div><span>Temperature</span><strong>{metric(env?.temperature_c)}°C</strong></div>
            <div><span>Heat Index</span><strong>{metric(env?.heat_index_c)}°C</strong></div>
            <div><span>Wet-bulb</span><strong>{metric(env?.wet_bulb_temperature_c)}°C</strong><small>Not WBGT</small></div>
            <div><span>Humidity</span><strong>{metric(env?.relative_humidity)}%</strong></div>
          </div>
        </>
      )}
    </section>
  );
}

function ForecastPanel({ cycle }) {
  const points = cycle?.heat_outlook?.points ?? [];
  return (
    <section className="panel v2-forecast-panel">
      <div className="panel-title-row">
        <div><div className="section-eyebrow">PREDICT</div><h2>Provider Sampled Outlook</h2></div>
        <Activity size={22} />
      </div>
      <div className="v2-sample-list">
        {points.length ? points.map((point) => (
          <div key={point.offset_hours} className={`v2-sample ${point.status === "available" ? "available" : "unavailable"}`}>
            <span>+{point.offset_hours}h</span>
            <strong>{point.status === "available" ? `${metric(point.temperature_c)}°C` : "Unavailable"}</strong>
            <small>{point.status === "available" ? "FortyGuard sampled tile" : "No interpolation"}</small>
          </div>
        )) : <div className="v2-empty compact"><Radar size={25} /><span>No sampled outlook yet.</span></div>}
      </div>
    </section>
  );
}

function SpatialPanel({ cycle }) {
  const spatial = cycle?.spatial_heat;
  const candidate = spatial?.candidates?.[0];
  return (
    <section className="panel v2-mini-panel">
      <div className="panel-title-row"><div><div className="section-eyebrow">SPATIAL</div><h2>Cooler-Zone Candidate</h2></div><MapPinned size={21} /></div>
      {candidate ? (
        <div className="v2-candidate-card">
          <strong>{metric(candidate.temperature_c)}°C sampled tile</strong>
          <span>{metric(candidate.cooler_by_c)}°C cooler than selected site</span>
          <small>{Math.round(candidate.straight_line_distance_m)} m straight-line · candidate, not a declared safe zone</small>
        </div>
      ) : (
        <div className="v2-empty compact"><span>{spatial ? humanize(spatial.status) : "Run analysis to evaluate nearby provider tiles."}</span></div>
      )}
    </section>
  );
}

function ShiftPanel({ cycle }) {
  const optimization = cycle?.shift_optimization;
  const best = optimization?.best_candidate;
  return (
    <section className="panel v2-mini-panel">
      <div className="panel-title-row"><div><div className="section-eyebrow">OPTIMIZE</div><h2>Shift Candidate</h2></div><Gauge size={21} /></div>
      {best ? (
        <div className="v2-candidate-card">
          <strong>{metric(best.duration_weighted_sampled_start_temperature_c)}°C weighted sampled start</strong>
          <span>{best.total_schedule_movement_hours}h total schedule movement</span>
          <small>Deterministic sampled-temperature optimization · not physiological heat dose</small>
        </div>
      ) : (
        <div className="v2-empty compact"><span>{optimization ? humanize(optimization.status) : "Run analysis to test feasible sampled start slots."}</span></div>
      )}
    </section>
  );
}

export default function AgenticV2App() {
  const inFlight = useRef(false);
  const [searchValue, setSearchValue] = useState("Phoenix, Arizona");
  const [location, setLocation] = useState({ ...PHOENIX_LOCATION });
  const [cycle, setCycle] = useState(null);
  const [mode, setMode] = useState("idle");
  const [error, setError] = useState(null);
  const [heatmapState, setHeatmapState] = useState({
    phase: "idle", activityId: null, providerStatus: null, mapData: null,
    featureCount: 0, request: null, error: null, fallbackReason: null,
  });

  const env = cycle?.current_assessment?.environmental_evidence;
  const screening = cycle?.current_assessment?.screening;
  const reasoning = cycle?.agent_decision?.reasoning_summary;
  const systemState = mode === "loading" ? "loading" : mode === "live" ? "connected" : mode === "replay" ? "replay" : mode === "error" ? "error" : "idle";

  const runAt = useCallback(async (selectedLocation, dateTime, analysisDatetime) => {
    const [heatmap, cycleResult] = await Promise.all([
      fetchHeatmap({
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
        dateTime,
        radiusMeters: 300,
        granularity: 100,
      }),
      fetchAgenticCycle(selectedLocation, { analysisDatetime }),
    ]);
    return { heatmap, cycleResult };
  }, []);

  const applyResult = useCallback((result, nextMode, fallbackReason = null) => {
    setCycle(result.cycleResult);
    setMode(nextMode);
    setHeatmapState({
      phase: nextMode,
      activityId: result.heatmap.activityId,
      providerStatus: result.heatmap.status,
      mapData: result.heatmap.mapData,
      featureCount: result.heatmap.featureCount,
      request: result.heatmap.request,
      error: null,
      fallbackReason,
    });
  }, []);

  const analyze = useCallback(async () => {
    if (inFlight.current) return;
    let selectedLocation;
    try {
      selectedLocation = parseLocationInput(searchValue);
    } catch (parseError) {
      setError(parseError?.message ?? "Invalid location.");
      return;
    }
    inFlight.current = true;
    setLocation(selectedLocation);
    setMode("loading");
    setError(null);
    setCycle(null);
    setHeatmapState((current) => ({ ...current, phase: "loading", mapData: null, error: null }));
    let currentFailure = null;
    try {
      const current = await runAt(selectedLocation, getCurrentPhoenixDateTimeFilter(), null);
      applyResult(current, "live");
      inFlight.current = false;
      return;
    } catch (currentError) {
      currentFailure = currentError?.message ?? "Current provider analysis was unavailable.";
    }
    try {
      const replay = await runAt(selectedLocation, VERIFIED_SNAPSHOT_FILTER, VERIFIED_REPLAY_DATETIME);
      applyResult(replay, "replay", currentFailure);
      setError(`Current hour unavailable. Replaying verified FortyGuard evidence. ${currentFailure}`);
    } catch (replayError) {
      setMode("error");
      setError(replayError?.message ?? currentFailure ?? "HeatShield analysis failed.");
      setHeatmapState((current) => ({ ...current, phase: "error", error: replayError?.message ?? currentFailure }));
    } finally {
      inFlight.current = false;
    }
  }, [applyResult, runAt, searchValue]);

  const updateCycle = useCallback((successor) => {
    setCycle(successor);
    setMode("live");
    setError(null);
    setHeatmapState((current) => ({
      ...current,
      phase: "idle",
      mapData: null,
      fallbackReason: "Fresh RECHECK completed. Run Analyze to refresh the separate visual heatmap layer.",
    }));
  }, []);

  const cards = useMemo(() => [
    { title: "Temperature", value: metric(env?.temperature_c), unit: "°C", detail: "FortyGuard temperature", icon: ThermometerSun, tone: "orange" },
    { title: "Heat Index", value: metric(env?.heat_index_c), unit: "°C", detail: bandLabel(screening?.band), icon: SunMedium, tone: "amber" },
    { title: "Humidity", value: metric(env?.relative_humidity), unit: "%", detail: "Relative humidity", icon: Droplets, tone: "cyan" },
    { title: "Wet-bulb", value: metric(env?.wet_bulb_temperature_c), unit: "°C", detail: "Wet-bulb — not WBGT", icon: Wind, tone: "blue" },
  ], [env, screening]);

  return (
    <div className="app-shell v2-shell">
      <Brand state={systemState} />
      <main className="dashboard-main v2-main">
        <header className="topbar">
          <form className="search-shell" onSubmit={(event) => { event.preventDefault(); analyze(); }}>
            <Search size={19} />
            <input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Phoenix or 33.4484, -112.0740" aria-label="Analyze Phoenix location" />
            <button type="submit" className="analyze-button" disabled={mode === "loading"}>
              {mode === "loading" ? <LoaderCircle className="spinner" size={17} /> : <Zap size={17} />}
              {mode === "loading" ? "Running agent..." : "Run closed-loop analysis"}
            </button>
          </form>
          <div className="topbar-status">
            <div className="weather-orb"><SunMedium size={24} /></div>
            <div className="weather-copy"><strong>{metric(env?.temperature_c)}{finite(env?.temperature_c) !== null ? "°C" : ""}</strong><span>Provider temperature</span></div>
            <div className="avatar">V2</div>
          </div>
        </header>

        <div className="dashboard-heading v2-heading">
          <div>
            <div className="section-eyebrow">HEATSHIELD AGENTIC V2</div>
            <h1>Thermal Operations Command Center</h1>
            <p>FortyGuard evidence → deterministic thermal science → eligibility firewall → bounded DeepSeek tools → supervisor-approved ACT → fresh VERIFY → RECHECK.</p>
          </div>
          <div className="location-summary">
            <MapPinned size={18} />
            <div><strong>{location.name}</strong><span>{location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}{mode === "replay" ? " · Historical Replay" : ""}</span></div>
          </div>
        </div>

        {error ? <div className="global-error"><AlertTriangle size={17} /><span>{error}</span></div> : null}

        <section className="v2-hero-state">
          <div><Sparkles size={18} /><span>Decision state</span><strong>{humanize(cycle?.agent_decision?.status ?? "waiting")}</strong></div>
          <div><ShieldCheck size={18} /><span>Tool firewall</span><strong>{cycle?.agent_decision?.eligibility_trace?.filter((item) => item.eligible).length ?? 0} eligible / {cycle?.agent_decision?.eligibility_trace?.length ?? 0} evaluated</strong></div>
          <div><BrainCircuit size={18} /><span>Evidence confidence</span><strong>{humanize(reasoning?.evidence_confidence ?? "unknown")}</strong></div>
          <div><Gauge size={18} /><span>Next step</span><strong>{humanize(cycle?.next_step ?? "run analysis")}</strong></div>
        </section>

        <section className="metrics-grid v2-metrics">
          <article className="metric-card risk-card v2-risk-card">
            <div className="metric-topline"><span className="metric-heading">Heat Screening</span><ShieldCheck size={18} /></div>
            <div className="v2-screening-value">{bandLabel(screening?.band)}</div>
            <div className="metric-detail">{cycle?.current_assessment ? `${humanize(cycle.current_assessment.data_quality)} evidence · ${humanize(reasoning?.urgency ?? "unknown")} urgency` : "Awaiting analysis"}</div>
          </article>
          {cards.map((item) => <MetricCard key={item.title} {...item} />)}
        </section>

        <section className="v2-grid-primary">
          <LiveHeatMap heatmapState={heatmapState} location={location} />
          <ThermalPanel cycle={cycle} />
        </section>

        <section className="v2-grid-secondary">
          <ForecastPanel cycle={cycle} />
          <SpatialPanel cycle={cycle} />
          <ShiftPanel cycle={cycle} />
        </section>

        <AgentMissionControl cycle={cycle} onCycleUpdate={updateCycle} />

        <footer className="dashboard-footer v2-footer">
          <div><Shield size={15} /> Human approval remains mandatory for operational actions.</div>
          <div>Wet-bulb ≠ WBGT · sampled candidates ≠ safe-period claims · verification ≠ causal proof</div>
        </footer>
      </main>
    </div>
  );
}
