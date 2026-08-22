import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Eye,
  Layers3,
  MapPin,
  Pencil,
  Plus,
  ShieldCheck,
  Sun,
  Thermometer,
  Users,
  X,
} from "lucide-react";
import GoogleSiteMap from "../../components/map/GoogleSiteMap.jsx";
import { fetchPremiumCandidateIntelligence } from "../../api/decisionIntelligenceApi.js";
import { fetchSelectedSiteHeatmap } from "../../api/mapIntelligenceApi.js";
import { BAND_LABEL, finite, humanize } from "../productUtils.js";
import { loadOperationalSummary } from "./operationalPlanState.js";
import MapIntelligencePanel from "./MapIntelligencePanel.jsx";
import {
  TASK_OPTIONS,
  activeCandidateZones,
  activeWorkZones,
  createWorker,
  loadCrewMap,
  loadSelectedSiteId,
  loadSites,
  pointInPolygon,
  polygonCenter,
  saveCrewMap,
  saveSelectedSiteId,
  workerPositionValid,
  zoneForPoint,
} from "./planWorkspace.js";
import "./MapScreen.css";

const SITE_SETUP_INTENT_KEY = "heatshield.siteSetup.intent.v1";
const cToF = (value) => finite(value) === null ? null : Math.round((value * 9) / 5 + 32);
const mph = (value) => finite(value) === null ? null : Math.round(value * .621371);
const shown = (value, suffix = "") => finite(value) === null ? "--" : `${Math.round(value)}${suffix}`;

function newDraft(crew, site) {
  const worker = createWorker(crew);
  const firstZone = activeWorkZones(site)[0] ?? null;
  const allowedZoneIds = activeCandidateZones(site).filter((zone) => zone.id !== firstZone?.id).map((zone) => zone.id);
  return {
    ...worker,
    name: "",
    zoneId: firstZone?.id || "",
    zoneLabel: firstZone?.name || "",
    allowedZoneIds,
    shiftEnd: "14:30",
    duration: 360,
    notes: "",
  };
}

function premiumTarget(scope, site, selectedWorker, selectedPoint) {
  if (scope === "worker" && selectedWorker?.position) return selectedWorker.position;
  if (scope === "point" && selectedPoint) return selectedPoint;
  const center = polygonCenter(site);
  return { latitude: center[0], longitude: center[1] };
}

export default function MapScreen({ location, weather, onNavigate }) {
  const sites = useMemo(() => loadSites(location), [location]);
  const [selectedSiteId, setSelectedSiteId] = useState(() => loadSelectedSiteId(sites));
  const site = sites.find((item) => item.id === selectedSiteId) ?? sites[0];
  const [crewMap, setCrewMap] = useState(() => loadCrewMap());
  const crew = site ? crewMap[site.id] ?? [] : [];
  const [draft, setDraft] = useState(() => newDraft(crew, site));
  const [workspaceMode, setWorkspaceMode] = useState("view");
  const [mapType, setMapType] = useState("satellite");
  const [heatVisible, setHeatVisible] = useState(false);
  const [siteHeat, setSiteHeat] = useState(null);
  const [heatBusy, setHeatBusy] = useState(false);
  const [premium, setPremium] = useState(null);
  const [premiumBusy, setPremiumBusy] = useState(false);
  const [intelligenceScope, setIntelligenceScope] = useState("site");
  const [intelligenceTab, setIntelligenceTab] = useState("overview");
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [error, setError] = useState(null);
  const current = weather?.current ?? {};
  const weatherF = cToF(current.temperature_2m_c);
  const heatFeatures = siteHeat?.mapData?.features ?? [];
  const workZones = activeWorkZones(site);
  const polygonReady = Boolean(site?.polygon?.length >= 3 && workZones.length);
  const inside = draft.position ? workerPositionValid(draft, site) : null;
  const planSummary = useMemo(() => loadOperationalSummary(site, crew), [site, crew]);
  const planByWorker = useMemo(() => new Map((planSummary?.workers || []).map((worker) => [worker.workerId, worker])), [planSummary]);
  const selectedWorker = crew.find((worker) => worker.workerId === selectedWorkerId) || null;

  function persist(nextCrew) {
    const next = { ...crewMap, [site.id]: nextCrew };
    setCrewMap(next);
    saveCrewMap(next);
  }

  function changeSite(nextSiteId) {
    const nextSite = sites.find((item) => item.id === nextSiteId) || sites[0];
    const nextCrew = nextSite ? crewMap[nextSite.id] ?? [] : [];
    setSelectedSiteId(nextSite?.id || null);
    if (nextSite?.id) saveSelectedSiteId(nextSite.id);
    setDraft(newDraft(nextCrew, nextSite));
    setSelectedWorkerId(null);
    setSelectedPoint(null);
    setSiteHeat(null);
    setHeatVisible(false);
    setPremium(null);
    setWorkspaceMode("view");
    setError(null);
  }

  function navigateSiteSetup(intent) {
    try {
      window.sessionStorage.setItem(SITE_SETUP_INTENT_KEY, intent);
    } catch {
      // Site setup still opens even when session storage is unavailable.
    }
    onNavigate("site-setup");
  }

  function setMode(mode) {
    setWorkspaceMode(mode);
    setError(null);
    if (mode === "workers") setDraft(newDraft(crew, site));
    if (mode === "intelligence" && !intelligenceScope) setIntelligenceScope("site");
  }

  function setField(field, value) {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
  }

  function selectWorker(workerId) {
    setSelectedWorkerId(workerId || null);
    if (intelligenceScope === "worker") setPremium(null);
  }

  function choosePoint(point) {
    if (workspaceMode === "intelligence") {
      if (site?.polygon?.length >= 3 && !pointInPolygon(point, site.polygon)) {
        setError("Choose an intelligence point inside the selected site boundary.");
        return;
      }
      setSelectedPoint(point);
      setIntelligenceScope("point");
      setPremium(null);
      setIntelligenceTab("overview");
      setError(null);
      return;
    }
    if (workspaceMode !== "workers") return;
    if (!pointInPolygon(point, site?.polygon ?? [])) {
      setError("Worker position must be inside the selected site boundary.");
      return;
    }
    const zone = zoneForPoint(site, point, ["work"]);
    if (!zone) {
      setError("Place the worker inside an active work zone, not only inside the master site boundary.");
      return;
    }
    const allowedZoneIds = activeCandidateZones(site).filter((candidate) => candidate.id !== zone.id).map((candidate) => candidate.id);
    setDraft((value) => ({ ...value, position: point, zoneId: zone.id, zoneLabel: zone.name, allowedZoneIds }));
    setError(null);
  }

  function moveWorker(workerId, point) {
    if (!pointInPolygon(point, site?.polygon ?? [])) {
      setError("Worker position must remain inside the selected site boundary.");
      return false;
    }
    const zone = zoneForPoint(site, point, ["work"]);
    if (!zone) {
      setError("Workers can only be moved to an active work zone. Use Plan for approved recovery/relocation alternatives.");
      return false;
    }
    persist(crew.map((worker) => worker.workerId === workerId ? {
      ...worker,
      position: point,
      zoneId: zone.id,
      zoneLabel: zone.name,
      allowedZoneIds: (worker.allowedZoneIds || []).filter((id) => id !== zone.id),
    } : worker));
    setError(null);
    return true;
  }

  function saveWorker() {
    if (!polygonReady) return setError("Draw the worksite boundary and at least one active work zone before adding workers.");
    if (!draft.workerId.trim() || !draft.name.trim() || !draft.currentTask.trim()) return setError("Worker ID, name and task are required.");
    if (crew.some((worker) => worker.workerId === draft.workerId)) return setError("Worker ID must be unique at this worksite.");
    if (!draft.position || !workerPositionValid(draft, site)) return setError("Place the worker at an exact point inside an active work zone.");
    if (!draft.shiftStart || !draft.shiftEnd || draft.shiftEnd <= draft.shiftStart) return setError("Enter a valid shift start and end time.");
    const nextCrew = [...crew, draft];
    persist(nextCrew);
    selectWorker(draft.workerId);
    setDraft(newDraft(nextCrew, site));
    setWorkspaceMode("view");
    setError(null);
  }

  async function loadHeat(force = false) {
    if (!site) return;
    setHeatBusy(true);
    setError(null);
    try {
      const result = await fetchSelectedSiteHeatmap(site, { force });
      setSiteHeat(result);
      setHeatVisible(true);
    } catch (requestError) {
      setError(requestError?.message || "FortyGuard heat layer is unavailable for this selected site.");
    } finally {
      setHeatBusy(false);
    }
  }

  async function toggleHeat() {
    if (heatVisible) {
      setHeatVisible(false);
      return;
    }
    if (siteHeat) {
      setHeatVisible(true);
      return;
    }
    await loadHeat(false);
  }

  async function runPremium() {
    if (!site || premiumBusy) return;
    if (intelligenceScope === "worker" && !selectedWorker?.position) return setError("Select a worker with an exact map position first.");
    if (intelligenceScope === "point" && !selectedPoint) return setError("Click a point inside the site before running point intelligence.");
    const target = premiumTarget(intelligenceScope, site, selectedWorker, selectedPoint);
    setPremiumBusy(true);
    setPremium(null);
    setError(null);
    try {
      const result = await fetchPremiumCandidateIntelligence(site, {
        centroid_latitude: target.latitude,
        centroid_longitude: target.longitude,
      }, site?.analysis_datetime);
      setPremium(result);
      if (result?.satellite) setIntelligenceTab("satellite");
      else if (result?.street_view) setIntelligenceTab("street");
      else setIntelligenceTab("overview");
    } catch (requestError) {
      setError(requestError?.message || "FortyGuard Premium imagery intelligence is unavailable for this target.");
    } finally {
      setPremiumBusy(false);
    }
  }

  const mapHint = workspaceMode === "workers"
    ? "Workers mode · click inside an active work zone to place a new worker, or drag an existing worker between active work zones."
    : workspaceMode === "intelligence"
      ? "Intelligence mode · inspect the selected site, a worker, or click a point inside the site for Premium imagery evidence."
      : "View mode · inspect the site, zones, workers and loaded FortyGuard heat evidence without changing geometry.";

  return <div className="hs-screen hs-site-map-screen">
    <section className="hs-site-summary-card"><span className="hs-site-pin"><MapPin/></span><div className="hs-site-copy"><strong>{site?.name || location?.name || "Selected worksite"}</strong><small>{site?.timezone || location?.timezone || "Timezone unavailable"} · {workZones.length} active work zone{workZones.length === 1 ? "" : "s"} · {crew.length} worker{crew.length === 1 ? "" : "s"}</small><em>{site?.address || location?.display_name || "Address unavailable"}</em></div><button type="button" onClick={() => navigateSiteSetup("edit")}><Pencil/> Edit site</button><div className="hs-site-weather"><Sun/><strong>{shown(weatherF, "°F")}</strong><span>{current.condition || "Weather unavailable"}</span></div><dl><div><dt>Feels like</dt><dd>{shown(cToF(current.apparent_temperature_c), "°F")}</dd></div><div><dt>Humidity</dt><dd>{shown(current.relative_humidity_percent, "%")}</dd></div><div><dt>Wind</dt><dd>{shown(mph(current.wind_speed_kmh), " mph")}</dd></div></dl></section>

    <div className="hs-map-command-bar">
      <div className="hs-map-command-modes">
        <select className="hs-map-site-picker" value={site?.id || ""} onChange={(event) => changeSite(event.target.value)} aria-label="Selected site">{sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button type="button" className={workspaceMode === "view" ? "active" : ""} onClick={() => setMode("view")}><Eye/>View</button>
        <button type="button" className={workspaceMode === "workers" ? "active" : ""} onClick={() => setMode("workers")}><Users/>Workers</button>
        <button type="button" className={workspaceMode === "intelligence" ? "active" : ""} onClick={() => setMode("intelligence")}><Layers3/>FortyGuard Intelligence</button>
      </div>
      <div className="hs-map-command-actions"><button type="button" onClick={() => navigateSiteSetup("add")}><Plus/>Add site</button><button type="button" className="primary" onClick={() => onNavigate("plan")}><ShieldCheck/>{planSummary ? "Open plan" : "Generate plan"}</button></div>
    </div>

    {error ? <div className="hs-map-inline-error"><AlertTriangle/><span>{error}</span><button type="button" onClick={() => setError(null)}><X/></button></div> : null}
    <div className={`hs-map-workspace ${workspaceMode === "intelligence" ? "intelligence-open" : ""} ${workspaceMode === "view" ? "view-only" : ""}`}>
      <section className="hs-advanced-site-map">
        <div className="hs-map-type-tabs">{[["roadmap","Streets"],["satellite","Satellite"],["terrain","Terrain"]].map(([id,label]) => <button key={id} type="button" className={mapType === id ? "active" : ""} onClick={() => setMapType(id)}>{label}</button>)}</div>
        <div className="hs-map-layer-toggles"><button type="button" className={`${heatVisible ? "active" : ""}${heatBusy ? " loading" : ""}`} onClick={toggleHeat} disabled={heatBusy}><Thermometer/>{heatBusy ? "Loading FortyGuard…" : "Heat Layer"}<i/></button><button type="button" className={workspaceMode === "intelligence" ? "active" : ""} onClick={() => setMode("intelligence")}><Layers3/>Premium Intelligence<i/></button></div>
        <div className="hs-map-mode-hint">{mapHint}</div>
        <GoogleSiteMap
          site={site}
          crew={crew}
          heatFeatures={heatFeatures}
          heatVisible={heatVisible}
          mapType={mapType}
          onMapClick={choosePoint}
          onWorkerMove={moveWorker}
          selectedWorkerId={selectedWorkerId}
          onSelectWorker={selectWorker}
          workersDraggable={workspaceMode === "workers"}
          inspectionPoint={workspaceMode === "intelligence" && intelligenceScope === "point" ? selectedPoint : null}
        />
        <div className="hs-heat-legend"><strong>FortyGuard TCM heat evidence</strong><i/><div><span>Cooler</span><span>Moderate</span><span>High</span><span>Highest</span></div><small>{siteHeat ? `${siteHeat.featureCount} cells · selected-site request · ${siteHeat.cacheHit ? "session cache" : "provider refreshed"}` : "Heat is intentionally on-demand. Load it for this selected site to avoid showing unrelated global evidence."}</small></div>
      </section>

      {workspaceMode === "workers" ? <aside className="hs-worker-drawer"><header><h2>Add / place worker</h2><button type="button" onClick={() => setMode("view")} aria-label="Close worker mode"><X/></button></header><div className="hs-drawer-form">
        <div className="two"><label><span>Worker ID *</span><input value={draft.workerId} onChange={(event) => setField("workerId", event.target.value)}/></label><label><span>Name *</span><input value={draft.name} onChange={(event) => setField("name", event.target.value)} placeholder="Worker name"/></label></div>
        <label><span>Exact work-zone location *</span><div className={`hs-location-validation ${inside === false ? "invalid" : inside ? "valid" : ""}`}><MapPin/>{draft.position ? `${draft.position.latitude.toFixed(5)}, ${draft.position.longitude.toFixed(5)} · ${draft.zoneLabel}` : "Click inside an active work zone"}{inside ? <Check/> : null}</div></label>
        <label><span>Role / Task *</span><input list="hs-map-task-options" value={draft.currentTask} onChange={(event) => setField("currentTask", event.target.value)}/><datalist id="hs-map-task-options">{TASK_OPTIONS.map((task) => <option key={task} value={task}/>)}</datalist></label>
        <div className="two"><label><span>Shift start *</span><input type="time" value={draft.shiftStart} onChange={(event) => setField("shiftStart", event.target.value)}/></label><label><span>Shift end *</span><input type="time" value={draft.shiftEnd} onChange={(event) => setField("shiftEnd", event.target.value)}/></label></div>
        <label><span>Work environment *</span><select value={draft.directSun ? "sun" : draft.outdoor ? "shade" : "indoor"} onChange={(event) => { const value = event.target.value; setDraft((item) => ({ ...item, outdoor: value !== "indoor", directSun: value === "sun" })); }}><option value="sun">Outdoor — Full sun</option><option value="shade">Outdoor — Shaded</option><option value="indoor">Indoor / sheltered</option></select></label>
        <div className="two"><label><span>Workload *</span><select value={draft.workload} onChange={(event) => setField("workload", event.target.value)}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label><label><span>Expected exposure *</span><select value={draft.duration} onChange={(event) => setField("duration", Number(event.target.value))}><option value="60">1 hr</option><option value="120">2 hrs</option><option value="240">4 hrs</option><option value="360">6 hrs</option><option value="480">8 hrs</option></select></label></div>
        <label><span>PPE burden *</span><select value={draft.ppe} onChange={(event) => setField("ppe", event.target.value)}><option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option></select></label>
        <label><span>Notes</span><textarea value={draft.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="Work context or exposure notes"/></label>
      </div><footer><button type="button" onClick={() => { setDraft(newDraft(crew, site)); setMode("view"); }}>Cancel</button><button type="button" onClick={saveWorker}><Check/>Done</button></footer><p><ShieldCheck/>Existing workers are draggable only in Workers mode. New points are accepted only inside active work zones.</p></aside> : null}

      {workspaceMode === "intelligence" ? <MapIntelligencePanel
        site={site}
        crew={crew}
        selectedWorkerId={selectedWorkerId}
        onSelectWorker={selectWorker}
        scope={intelligenceScope}
        onScopeChange={(scope) => { setIntelligenceScope(scope); setPremium(null); setIntelligenceTab("overview"); }}
        selectedPoint={selectedPoint}
        heat={siteHeat}
        heatBusy={heatBusy}
        onRefreshHeat={() => loadHeat(true)}
        premium={premium}
        premiumBusy={premiumBusy}
        onRunPremium={runPremium}
        tab={intelligenceTab}
        onTabChange={setIntelligenceTab}
        onClose={() => setMode("view")}
      /> : null}
    </div>

    <div className="hs-map-bottom-grid"><section className="hs-workers-table"><header><h2>All Workers <span>{crew.length}</span></h2><button type="button" onClick={() => onNavigate("crew-setup")}>Edit worker details</button></header>{crew.length ? <div>{crew.map((worker) => { const planned = planByWorker.get(worker.workerId); const band = planned?.band; return <button key={worker.workerId} type="button" onClick={() => selectWorker(worker.workerId)}><span className="hs-worker-avatar">{(worker.name || worker.workerId).slice(0,2).toUpperCase()}</span><span><strong>{worker.workerId}</strong><small>{worker.name}</small></span><span><strong>{worker.currentTask}</strong><small>{worker.zoneLabel || "Work zone not set"}</small></span><em>{BAND_LABEL[band] || (planSummary ? "Evidence pending" : "Plan not generated")}</em><b>{planned ? `Priority ${planned.attentionOrder || "--"}` : "Configured"}</b><ChevronRight/></button>; })}</div> : <div className="hs-map-empty"><Users/>No workers have been added to this worksite.</div>}</section>
    <section className="hs-worker-plans-list"><header><h2>Worker Plans</h2><button type="button" onClick={() => onNavigate("plan")}>{planSummary ? "Open plan" : "Generate plans"}</button></header>{planSummary?.workers?.length ? planSummary.workers.map((worker) => <button key={worker.workerId} type="button" onClick={() => onNavigate("plan")}><ShieldCheck/><span><strong>{worker.name} · {BAND_LABEL[worker.band] || humanize(worker.band || "evidence pending")}</strong><small>{worker.primaryAction ? `${humanize(worker.primaryAction.actionType)} · ${humanize(worker.primaryAction.status)}` : humanize(worker.agentStatus || "no action selected")}</small></span><ChevronRight/></button>) : <div className="hs-map-empty"><ShieldCheck/>Plans appear after the site and worker setup is analyzed.</div>}</section></div>
  </div>;
}
