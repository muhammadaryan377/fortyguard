import { useCallback, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, BrainCircuit, CheckCircle2, ClipboardCheck, Droplets,
  Eye, Flame, Gauge, Hexagon, Layers3, LoaderCircle, LockKeyhole, MapPinned,
  Radar, RefreshCw, Search, Shield, ShieldCheck, Sparkles, SunMedium,
  TerminalSquare, ThermometerSun, Wind, Zap,
} from "lucide-react";

import { parseLocationInput, PHOENIX_LOCATION, VERIFIED_REPLAY_DATETIME } from "./api/heatshieldApi.js";
import { fetchAgenticCycle } from "./api/agenticApi.js";
import LiveHeatMap from "./components/map/LiveHeatMap.jsx";
import AgentMissionControl from "./components/agent/AgentMissionControl.jsx";
import "./App.css";
import "./AgenticV2App.css";

const NAV = [
  ["command", "Command Center", BrainCircuit],
  ["thermal", "Thermal Evidence", ThermometerSun],
  ["spatial", "Spatial Intelligence", MapPinned],
  ["optimizer", "Shift Optimizer", Gauge],
  ["actions", "Agent Actions", ClipboardCheck],
  ["verification", "Verification Loop", RefreshCw],
];
const META = {
  command: ["HEATSHIELD AGENTIC V2", "Thermal Operations Command Center", "FortyGuard evidence -> deterministic thermal science -> eligibility firewall -> bounded DeepSeek tools -> supervisor-approved ACT -> fresh VERIFY -> RECHECK."],
  thermal: ["PROVIDER-GROUNDED THERMAL SCIENCE", "Thermal Evidence Workspace", "Inspect the current observation, Heat Index screening, provider provenance, evidence confidence and science boundaries."],
  spatial: ["FORTYGUARD SPATIAL INTELLIGENCE", "Spatial Heat Intelligence", "Compare the selected site tile with strictly cooler provider-backed tiles. Cooler is comparative evidence, not a safe-zone claim."],
  optimizer: ["DETERMINISTIC SHIFT OPTIMIZATION", "Sampled-Temperature Shift Optimizer", "Evaluate feasible task starts against exact FortyGuard samples without interpolation, invented hours or physiological heat-dose claims."],
  actions: ["BOUNDED AGENT OPERATIONS", "Agent Actions", "Review the server eligibility firewall, structured rationale and proposed actions before supervisor authorization."],
  verification: ["CLOSED-LOOP ASSURANCE", "Verification & Recheck Loop", "Verify action state against fresh provider evidence, preserve causality boundaries and create the successor cycle."],
};

const finite = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
const metric = (v, d = 1) => finite(v) === null ? "--" : v.toFixed(d);
const humanize = (v) => !v ? "Unavailable" : String(v).replaceAll("_", " ").replace(/\b\w/g, (x) => x.toUpperCase());
const bandLabel = (v) => ({ below_caution: "Below Caution", caution: "Caution", extreme_caution: "Extreme Caution", danger: "Danger", extreme_danger: "Extreme Danger" }[v] ?? "Unavailable");
const evidenceValue = (v) => {
  if (v === null || v === undefined) return "--";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (Array.isArray(v)) return v.map(evidenceValue).join(", ");
  if (typeof v === "object") return Object.entries(v).slice(0, 4).map(([k, x]) => `${humanize(k)}: ${evidenceValue(x)}`).join(" | ");
  return String(v);
};

function providerDateTime(value, timezone = "America/Phoenix") {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return { start_date: `${parts.year}-${parts.month}-${parts.day}`, start_time: `${parts.hour}:${parts.minute}`, filter_type: 1 };
}

function mapStateFromCycle(cycle, phase, fallbackReason = null) {
  const spatial = cycle?.spatial_heat;
  const tiles = spatial?.tiles ?? [];
  if (!tiles.length) return {
    phase: cycle ? "error" : "idle", activityId: spatial?.heatmap_activity_id ?? null,
    providerStatus: spatial?.status ?? null, mapData: null, featureCount: 0, request: null,
    error: cycle ? "Spatial provider polygons were unavailable. Thermal evidence may still be usable." : null,
    fallbackReason,
  };
  const mapData = { type: "FeatureCollection", features: tiles.map((tile) => ({
    type: "Feature",
    properties: { tile_id: tile.tile_id, average_temperature: tile.temperature_c, contains_site: tile.contains_site, straight_line_distance_m: tile.straight_line_distance_m },
    geometry: { type: "Polygon", coordinates: tile.polygon_coordinates },
  })) };
  return {
    phase, activityId: spatial.heatmap_activity_id, providerStatus: spatial.status,
    mapData, featureCount: mapData.features.length,
    request: { date_time: providerDateTime(spatial.generated_at, spatial.timezone_name) },
    error: null, fallbackReason,
  };
}

function Navigation({ state, active, onNavigate }) {
  const buttons = NAV.map(([id, label, Icon]) => (
    <button type="button" key={id} className={`nav-item ${active === id ? "active" : ""}`} onClick={() => onNavigate(id)} aria-current={active === id ? "page" : undefined}>
      <Icon size={18} /><span>{label}</span>
    </button>
  ));
  return <>
    <aside className="sidebar v2-sidebar">
      <div className="brand"><div className="brand-mark"><Shield size={39} strokeWidth={1.8} /><Flame className="brand-flame" size={18} fill="currentColor" /></div><div><div className="brand-name"><span>Heat</span>Shield</div><div className="brand-subtitle">Agentic Heat Intelligence</div></div></div>
      <nav className="v2-nav-block">{buttons}</nav>
      <div className="sidebar-footer">
        <div className="provider-card"><div className="provider-icon"><Hexagon size={30} /><span /></div><div><small>Evidence provider</small><strong>FortyGuard</strong></div></div>
        <div className="agent-provider-card"><BrainCircuit size={19} /><div><small>Bounded decision model</small><strong>DeepSeek + server firewall</strong></div></div>
        <div className="system-card"><strong>Closed-loop status</strong><div className={`system-state system-${state}`}><span className="status-dot" />{state === "loading" ? "Analysis running" : state === "connected" ? "Agent cycle connected" : state === "replay" ? "Historical replay" : state === "error" ? "Needs attention" : "Ready"}</div></div>
      </div>
    </aside>
    <nav className="v2-mobile-nav">{buttons}</nav>
  </>;
}

function Heading({ screen, location, mode }) {
  const [eyebrow, title, description] = META[screen];
  return <div className="dashboard-heading v2-heading"><div><div className="section-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="location-summary"><MapPinned size={18} /><div><strong>{location.name}</strong><span>{location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}{mode === "replay" ? " | Historical Replay" : ""}</span></div></div></div>;
}

function MetricCard({ title, value, unit, detail, Icon, tone }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-topline"><span className="metric-heading">{title}</span><span className="provider-mini">FG</span></div><div className="metric-body"><div><div className="metric-value">{value}{value !== "--" ? <span>{unit}</span> : null}</div><div className="metric-detail">{detail}</div></div><div className={`metric-icon icon-${tone}`}><Icon size={25} /></div></div></article>;
}

function Metrics({ cycle }) {
  const env = cycle?.current_assessment?.environmental_evidence;
  const screening = cycle?.current_assessment?.screening;
  const urgency = cycle?.agent_decision?.reasoning_summary?.urgency;
  const cards = [
    ["Temperature", metric(env?.temperature_c), "°C", "FortyGuard temperature", ThermometerSun, "orange"],
    ["Heat Index", metric(env?.heat_index_c), "°C", bandLabel(screening?.band), SunMedium, "amber"],
    ["Humidity", metric(env?.relative_humidity), "%", "Relative humidity", Droplets, "cyan"],
    ["Wet-bulb", metric(env?.wet_bulb_temperature_c), "°C", "Wet-bulb - not WBGT", Wind, "blue"],
  ];
  return <section className="metrics-grid v2-metrics"><article className="metric-card risk-card v2-risk-card"><div className="metric-topline"><span className="metric-heading">Heat Screening</span><ShieldCheck size={18} /></div><div className="v2-screening-value">{bandLabel(screening?.band)}</div><div className="metric-detail">{cycle ? `${humanize(cycle.current_assessment?.data_quality)} evidence | ${humanize(urgency)} urgency` : "Awaiting analysis"}</div></article>{cards.map(([title, value, unit, detail, Icon, tone]) => <MetricCard key={title} title={title} value={value} unit={unit} detail={detail} Icon={Icon} tone={tone} />)}</section>;
}

function Hero({ cycle }) {
  const d = cycle?.agent_decision;
  const r = d?.reasoning_summary;
  const eligible = d?.eligibility_trace ?? [];
  return <section className="v2-hero-state"><div><Sparkles size={18} /><span>Decision state</span><strong>{humanize(d?.status ?? "waiting")}</strong></div><div><ShieldCheck size={18} /><span>Tool firewall</span><strong>{eligible.filter((x) => x.eligible).length} eligible / {eligible.length} evaluated</strong></div><div><BrainCircuit size={18} /><span>Evidence confidence</span><strong>{humanize(r?.evidence_confidence ?? "unknown")}</strong></div><div><Gauge size={18} /><span>Next step</span><strong>{humanize(cycle?.next_step ?? "run analysis")}</strong></div></section>;
}

function Thermal({ cycle }) {
  const a = cycle?.current_assessment, env = a?.environmental_evidence, s = a?.screening, r = cycle?.agent_decision?.reasoning_summary;
  if (!cycle) return <section className="panel v2-thermal-panel"><div className="panel-title-row"><div><div className="section-eyebrow">ASSESS</div><h2>Thermal Evidence Engine</h2></div><ShieldCheck size={22} /></div><div className="v2-empty"><Radar size={30} /><strong>Awaiting evidence</strong><span>Run analysis to start the provider-backed cycle.</span></div></section>;
  return <section className="panel v2-thermal-panel"><div className="panel-title-row"><div><div className="section-eyebrow">ASSESS</div><h2>Thermal Evidence Engine</h2></div><ShieldCheck size={22} /></div><div className="v2-risk-banner"><div><small>Heat-index screening</small><strong>{bandLabel(s?.band)}</strong></div><div><small>Evidence quality</small><strong>{humanize(a?.data_quality)}</strong></div><div><small>Agent urgency</small><strong>{humanize(r?.urgency)}</strong></div></div><p className="v2-thermal-copy">{r?.thermal_interpretation ?? a?.explanations?.[0] ?? "Deterministic assessment complete."}</p><div className="v2-science-grid"><div><span>Temperature</span><strong>{metric(env?.temperature_c)}°C</strong></div><div><span>Heat Index</span><strong>{metric(env?.heat_index_c)}°C</strong></div><div><span>Wet-bulb</span><strong>{metric(env?.wet_bulb_temperature_c)}°C</strong><small>Not WBGT</small></div><div><span>Humidity</span><strong>{metric(env?.relative_humidity)}%</strong></div></div></section>;
}

function Forecast({ cycle }) {
  const points = cycle?.heat_outlook?.points ?? [];
  return <section className="panel v2-forecast-panel"><div className="panel-title-row"><div><div className="section-eyebrow">PREDICT</div><h2>Provider Sampled Outlook</h2></div><Activity size={22} /></div><div className="v2-sample-list">{points.length ? points.map((p) => <div key={p.offset_hours} className={`v2-sample ${p.status === "available" ? "available" : "unavailable"}`}><span>+{p.offset_hours}h</span><strong>{p.status === "available" ? `${metric(p.temperature_c)}°C` : "Unavailable"}</strong><small>{p.status === "available" ? "FortyGuard sampled tile" : "No interpolation"}</small></div>) : <div className="v2-empty compact"><Radar size={25} /><span>No sampled outlook yet.</span></div>}</div></section>;
}

function SpatialSummary({ cycle }) {
  const s = cycle?.spatial_heat, c = s?.candidates?.[0];
  return <section className="panel v2-mini-panel"><div className="panel-title-row"><div><div className="section-eyebrow">SPATIAL</div><h2>Cooler-Zone Candidate</h2></div><MapPinned size={21} /></div>{c ? <div className="v2-candidate-card"><strong>{metric(c.temperature_c)}°C sampled tile</strong><span>{metric(c.cooler_by_c)}°C cooler than selected site</span><small>{Math.round(c.straight_line_distance_m)} m straight-line | candidate, not a declared safe zone</small></div> : <div className="v2-empty compact"><span>{s ? humanize(s.status) : "Run analysis to evaluate nearby provider tiles."}</span></div>}</section>;
}

function ShiftSummary({ cycle }) {
  const o = cycle?.shift_optimization, b = o?.best_candidate;
  return <section className="panel v2-mini-panel"><div className="panel-title-row"><div><div className="section-eyebrow">OPTIMIZE</div><h2>Shift Candidate</h2></div><Gauge size={21} /></div>{b ? <div className="v2-candidate-card"><strong>{metric(b.duration_weighted_sampled_start_temperature_c)}°C weighted sampled start</strong><span>{b.total_schedule_movement_hours}h total schedule movement</span><small>Deterministic sampled-temperature optimization | not physiological heat dose</small></div> : <div className="v2-empty compact"><span>{o ? humanize(o.status) : "Run analysis to test feasible sampled start slots."}</span></div>}</section>;
}

function EvidenceDetails({ cycle }) {
  const env = cycle?.current_assessment?.environmental_evidence;
  const p = env?.provenance;
  const signals = cycle?.agent_decision?.reasoning_summary?.evidence_signals ?? [];
  const guardrails = cycle?.agent_decision?.reasoning_summary?.guardrails ?? [];
  return <section className="v2-detail-grid"><Thermal cycle={cycle} /><section className="panel v2-detail-panel"><div className="panel-title-row"><div><div className="section-eyebrow">EVIDENCE GRAPH</div><h2>Decision Signals</h2></div><BrainCircuit size={21} /></div><div className="v2-evidence-list">{signals.length ? signals.map((x) => <article className="v2-evidence-row" key={`${x.signal}-${x.source}`}><div><strong>{humanize(x.signal)}</strong><span className={`v2-confidence confidence-${x.confidence}`}>{x.confidence}</span></div><small>{x.source}</small><b>{evidenceValue(x.value)}</b><p>{x.implication}</p></article>) : <div className="v2-empty compact"><span>Signals appear after a complete cycle.</span></div>}</div></section><section className="panel v2-detail-panel"><div className="panel-title-row"><div><div className="section-eyebrow">PROVENANCE</div><h2>Provider Evidence Chain</h2></div><TerminalSquare size={21} /></div><div className="v2-key-value-grid">{[["Heatmap activity",p?.heatmap_activity_id],["Environment activity",p?.environment_activity_id],["Requested timestamp",p?.requested_timestamp],["Matched provider timestamp",p?.matched_provider_timestamp],["Temperature extraction",p?.temperature_extraction_method],["Evidence source",p?.temperature_source]].map(([k,v]) => <div key={k}><span>{k}</span><strong>{v ?? "--"}</strong></div>)}</div></section><section className="panel v2-detail-panel v2-wide-panel"><div className="panel-title-row"><div><div className="section-eyebrow">SCIENCE + SAFETY</div><h2>Operational Boundaries</h2></div><Shield size={21} /></div><div className="v2-boundary-grid">{["Wet-bulb temperature is not WBGT.","Heat Index is a screening metric, not complete occupational risk.","A cooler sampled time or tile is not a safe-time or safe-zone declaration.","Verification observes fresh evidence without claiming causality.",...guardrails].filter((x,i,a) => a.indexOf(x) === i).map((x) => <div key={x}><CheckCircle2 size={15}/><span>{x}</span></div>)}</div></section></section>;
}

function SpatialDetails({ cycle, heatmapState, location }) {
  const s = cycle?.spatial_heat, candidates = s?.candidates ?? [];
  return <><Hero cycle={cycle}/><section className="v2-grid-primary v2-spatial-workspace"><LiveHeatMap heatmapState={heatmapState} location={location}/><section className="panel v2-detail-panel"><div className="panel-title-row"><div><div className="section-eyebrow">RANKED PROVIDER TILES</div><h2>Cooler-Zone Analysis</h2></div><Layers3 size={21}/></div>{s ? <><div className="v2-stat-strip"><div><span>Site tile</span><strong>{metric(s.site_reference?.site_temperature_c)}°C</strong></div><div><span>Valid tiles</span><strong>{s.summary?.valid_tile_count ?? 0}</strong></div><div><span>Cooler candidates</span><strong>{s.summary?.cooler_candidate_count ?? 0}</strong></div></div><div className="v2-candidate-list">{candidates.length ? candidates.map((c) => <article key={c.candidate_id}><div className="v2-rank">#{c.rank}</div><div><strong>{metric(c.temperature_c)}°C</strong><span>{metric(c.cooler_by_c)}°C cooler</span></div><div><strong>{Math.round(c.straight_line_distance_m)} m</strong><span>straight-line</span></div><small>{c.tile_id}</small></article>) : <div className="v2-empty compact"><span>No strictly cooler candidate validated.</span></div>}</div></> : <div className="v2-empty"><MapPinned size={30}/><span>Run analysis for spatial evidence.</span></div>}</section></section><section className="v2-detail-grid compact-grid"><SpatialSummary cycle={cycle}/><Limitations title="Spatial limitations" items={s?.limitations}/></section></>;
}

function Limitations({ title, items }) {
  const list = items?.length ? items : ["No additional limitation text is available for this result."];
  return <section className="panel v2-detail-panel"><div className="panel-title-row"><div><div className="section-eyebrow">BOUNDARIES</div><h2>{title}</h2></div><AlertTriangle size={21}/></div><div className="v2-limitations">{list.map((x) => <div key={x}><AlertTriangle size={14}/><span>{x}</span></div>)}</div></section>;
}

function OptimizerDetails({ cycle }) {
  const o = cycle?.shift_optimization, b = o?.best_candidate;
  return <><Hero cycle={cycle}/><section className="v2-detail-grid"><Forecast cycle={cycle}/><ShiftSummary cycle={cycle}/><section className="panel v2-detail-panel v2-wide-panel"><div className="panel-title-row"><div><div className="section-eyebrow">DETERMINISTIC PLAN SEARCH</div><h2>Shift Optimization Detail</h2></div><Gauge size={21}/></div>{o ? <><div className="v2-stat-strip four"><div><span>Status</span><strong>{humanize(o.status)}</strong></div><div><span>Current weighted start</span><strong>{metric(o.current_plan?.duration_weighted_sampled_start_temperature_c)}°C</strong></div><div><span>Best weighted start</span><strong>{metric(b?.duration_weighted_sampled_start_temperature_c)}°C</strong></div><div><span>Alternatives</span><strong>{o.candidates?.length ?? 0}</strong></div></div>{b ? <div className="v2-assignment-table"><div className="v2-assignment-head"><span>Task</span><span>Start sample</span><span>Temperature</span><span>Movement</span></div>{b.assignments.map((a) => <div className="v2-assignment-row" key={a.task_id}><div><strong>{a.task_name}</strong><small>{humanize(a.workload_level)} | {a.direct_sun ? "direct sun" : "no direct sun flag"}</small></div><span>+{a.candidate_offset_hours}h</span><span>{metric(a.sampled_start_temperature_c)}°C</span><span>{a.schedule_movement_hours}h</span></div>)}</div> : <div className="v2-empty compact"><span>No better feasible sampled plan validated.</span></div>}<div className="v2-boundary-note"><ShieldCheck size={16}/><span>The sampled-temperature-minutes index is a relative planning index only; it is not physiological heat dose, WBGT, medical risk or legal compliance.</span></div></> : <div className="v2-empty"><Gauge size={30}/><span>Run analysis to generate sampled-start candidates.</span></div>}</section><Limitations title="Optimizer limitations" items={o?.limitations}/></section></>;
}

function DecisionOverview({ cycle, onOpen }) {
  const d = cycle?.agent_decision, r = d?.reasoning_summary, e = d?.eligibility_trace ?? [], selected = r?.selected_action_types ?? [];
  return <section className="panel v2-decision-overview"><div className="panel-title-row"><div><div className="section-eyebrow">DECIDE</div><h2>Bounded Agent Decision</h2></div><BrainCircuit size={22}/></div>{d ? <div className="v2-decision-layout"><div className="v2-decision-copy"><div className="v2-decision-chips"><span>{d.model}</span><span>{humanize(r?.urgency)} urgency</span><span>{e.filter((x)=>x.eligible).length}/{e.length} tools visible</span></div><p>{r?.thermal_interpretation}</p></div><div className="v2-selected-actions"><span>AI-selected action types</span>{selected.length ? selected.map((x)=><strong key={x}>{humanize(x)}</strong>) : <strong>No action selected</strong>}</div><button type="button" className="v2-open-workspace" onClick={onOpen}><ClipboardCheck size={16}/>Open Agent Actions</button></div> : <div className="v2-empty compact"><span>Decision appears after provider evidence and deterministic assessment.</span></div>}</section>;
}

export default function AgenticV2App() {
  const inFlight = useRef(false);
  const [screen, setScreen] = useState("command");
  const [search, setSearch] = useState("Phoenix, Arizona");
  const [location, setLocation] = useState({ ...PHOENIX_LOCATION });
  const [cycle, setCycle] = useState(null);
  const [mode, setMode] = useState("idle");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [heatmapState, setHeatmapState] = useState(mapStateFromCycle(null, "idle"));
  const env = cycle?.current_assessment?.environmental_evidence;
  const state = mode === "loading" ? "loading" : mode === "live" ? "connected" : mode === "replay" ? "replay" : mode === "error" ? "error" : "idle";
  const navigate = useCallback((next) => { setScreen(next); window.scrollTo({ top: 0, behavior: "smooth" }); }, []);
  const apply = useCallback((result, nextMode, reason = null) => { setCycle(result); setMode(nextMode); setHeatmapState(mapStateFromCycle(result, nextMode, reason)); }, []);

  const analyze = useCallback(async () => {
    if (inFlight.current) return;
    let selected;
    try { selected = parseLocationInput(search); } catch (e) { setError(e?.message ?? "Invalid location."); return; }
    inFlight.current = true; setLocation(selected); setMode("loading"); setError(null); setNotice(null); setCycle(null); setHeatmapState((x) => ({ ...x, phase: "loading", mapData: null, error: null }));
    let currentFailure = null;
    try { const current = await fetchAgenticCycle(selected); apply(current, "live"); inFlight.current = false; return; }
    catch (e) { currentFailure = e?.message ?? "Current provider analysis was unavailable."; }
    try { const replay = await fetchAgenticCycle(selected, { analysisDatetime: VERIFIED_REPLAY_DATETIME }); apply(replay, "replay", currentFailure); setNotice(`Current hour unavailable. Replaying verified FortyGuard evidence. ${currentFailure}`); }
    catch (e) { const message = e?.message ?? currentFailure ?? "HeatShield analysis failed."; setMode("error"); setError(message); setHeatmapState((x) => ({ ...x, phase: "error", error: message })); }
    finally { inFlight.current = false; }
  }, [apply, search]);

  const updateCycle = useCallback((successor) => { setCycle(successor); setMode("live"); setError(null); setNotice("Fresh RECHECK completed. The command center now reflects the successor cycle."); setHeatmapState(mapStateFromCycle(successor, "live", "Fresh RECHECK successor cycle")); }, []);

  return <div className="app-shell v2-shell">
    <Navigation state={state} active={screen} onNavigate={navigate}/>
    <main className="dashboard-main v2-main">
      <header className="topbar"><form className="search-shell" onSubmit={(e) => { e.preventDefault(); analyze(); }}><Search size={19}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Phoenix or 33.4484, -112.0740"/><button type="submit" className="analyze-button" disabled={mode === "loading"}>{mode === "loading" ? <LoaderCircle className="spinner" size={17}/> : <Zap size={17}/>} {mode === "loading" ? "Running agent..." : "Run closed-loop analysis"}</button></form><div className="topbar-status"><div className="weather-orb"><SunMedium size={24}/></div><div className="weather-copy"><strong>{metric(env?.temperature_c)}{finite(env?.temperature_c) !== null ? "°C" : ""}</strong><span>Provider temperature</span></div><div className="avatar">V2</div></div></header>
      <Heading screen={screen} location={location} mode={mode}/>
      {error ? <div className="global-error"><AlertTriangle size={17}/><span>{error}</span></div> : null}
      {notice ? <div className="global-notice"><CheckCircle2 size={17}/><span>{notice}</span></div> : null}

      {screen === "command" ? <><Hero cycle={cycle}/><Metrics cycle={cycle}/><section className="v2-grid-primary"><LiveHeatMap heatmapState={heatmapState} location={location}/><Thermal cycle={cycle}/></section><section className="v2-grid-secondary"><Forecast cycle={cycle}/><SpatialSummary cycle={cycle}/><ShiftSummary cycle={cycle}/></section><DecisionOverview cycle={cycle} onOpen={()=>navigate("actions")}/></> : null}
      {screen === "thermal" ? <><Metrics cycle={cycle}/><EvidenceDetails cycle={cycle}/></> : null}
      {screen === "spatial" ? <SpatialDetails cycle={cycle} heatmapState={heatmapState} location={location}/> : null}
      {screen === "optimizer" ? <OptimizerDetails cycle={cycle}/> : null}
      <section className={`v2-operations-workspace ${["actions","verification"].includes(screen) ? "visible" : "hidden"}`} aria-hidden={!(["actions","verification"].includes(screen))}>
        <section className="panel v2-operation-intro"><div className="v2-operation-icon">{screen === "verification" ? <Eye size={24}/> : <LockKeyhole size={24}/>}</div><div><div className="section-eyebrow">{screen === "verification" ? "VERIFY -> RECHECK" : "APPROVE -> ACT"}</div><h2>{screen === "verification" ? "Closed-loop verification workspace" : "Human-gated operational workspace"}</h2><p>{screen === "verification" ? "Verify internal action state with fresh provider evidence, then create the successor cycle. Observed changes are not claimed as causal effects." : "DeepSeek selects only server-visible tools. Nothing executes until a supervisor explicitly approves proposed actions."}</p></div></section>
        <AgentMissionControl cycle={cycle} onCycleUpdate={updateCycle}/>
      </section>
      <footer className="dashboard-footer v2-footer"><div><Shield size={15}/> Human approval remains mandatory for operational actions.</div><div>Wet-bulb != WBGT | sampled candidates != safe-period claims | verification != causal proof</div></footer>
    </main>
  </div>;
}
