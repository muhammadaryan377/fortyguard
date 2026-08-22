import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Layers, LoaderCircle, MapPin, Plus, ShieldCheck, Sun, Thermometer, Users, X } from "lucide-react";
import GoogleSiteMap from "../../components/map/GoogleSiteMap.jsx";
import { fetchPremiumCandidateIntelligence } from "../../api/decisionIntelligenceApi.js";
import { BAND_LABEL, finite, humanize } from "../productUtils.js";
import { TASK_OPTIONS, createWorker, loadCrewMap, loadSelectedSiteId, loadSites, pointInPolygon, polygonCenter, saveCrewMap } from "./planWorkspace.js";

const cToF = (value) => finite(value) === null ? null : Math.round((value * 9) / 5 + 32);
const mph = (value) => finite(value) === null ? null : Math.round(value * .621371);
const shown = (value, suffix = "") => finite(value) === null ? "--" : `${Math.round(value)}${suffix}`;

function newDraft(crew) { const worker = createWorker(crew); return { ...worker, name: "", zoneLabel: "", shiftEnd: "14:30", duration: 360, notes: "" }; }

export default function MapScreen({ location, cycle, weather, heatmapState, analysisBusy, onNavigate }) {
  const sites = useMemo(() => loadSites(location), [location]);
  const selectedSiteId = useMemo(() => loadSelectedSiteId(sites), [sites]);
  const site = sites.find((item) => item.id === selectedSiteId) ?? sites[0];
  const [crewMap, setCrewMap] = useState(() => loadCrewMap());
  const crew = site ? crewMap[site.id] ?? [] : [];
  const [draft, setDraft] = useState(() => newDraft(crew));
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [mapType, setMapType] = useState("roadmap");
  const [heatVisible, setHeatVisible] = useState(true);
  const [segmentationVisible, setSegmentationVisible] = useState(false);
  const [premium, setPremium] = useState(null);
  const [premiumBusy, setPremiumBusy] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [error, setError] = useState(null);
  const current = weather?.current ?? {};
  const weatherF = cToF(current.temperature_2m_c);
  const center = polygonCenter(site);
  const heatFeatures = heatmapState?.mapData?.features ?? [];
  const polygonReady = Boolean(site?.polygon?.length >= 3);
  const inside = draft.position ? pointInPolygon(draft.position, site?.polygon ?? []) : null;

  function persist(nextCrew) { const next = { ...crewMap, [site.id]: nextCrew }; setCrewMap(next); saveCrewMap(next); }
  function setField(field, value) { setDraft((currentDraft) => ({ ...currentDraft, [field]: value })); }
  function choosePoint(point) { if (!drawerOpen) return; setDraft((value) => ({ ...value, position: point, zoneLabel: value.zoneLabel || "Inside site boundary" })); setError(pointInPolygon(point, site?.polygon ?? []) ? null : "Worker position must be inside the selected site boundary."); }
  function moveWorker(workerId, point) { if (!pointInPolygon(point, site?.polygon ?? [])) { setError("Worker position must remain inside the selected site boundary."); return; } persist(crew.map((worker) => worker.workerId === workerId ? { ...worker, position: point } : worker)); }
  function saveWorker() {
    if (!polygonReady) return setError("Draw and save the worksite boundary before adding workers.");
    if (!draft.workerId.trim() || !draft.name.trim() || !draft.currentTask.trim()) return setError("Worker ID, name and task are required.");
    if (crew.some((worker) => worker.workerId === draft.workerId)) return setError("Worker ID must be unique at this worksite.");
    if (!draft.position || !inside) return setError("Place the worker at an exact point inside the site boundary.");
    if (!draft.shiftStart || !draft.shiftEnd || draft.shiftEnd <= draft.shiftStart) return setError("Enter a valid shift start and end time.");
    persist([...crew, draft]); setSelectedWorkerId(draft.workerId); setDraft(newDraft([...crew, draft])); setDrawerOpen(false); setError(null);
  }
  async function toggleSegmentation() {
    const next = !segmentationVisible; setSegmentationVisible(next);
    if (!next || premium || premiumBusy) return;
    setPremiumBusy(true); setError(null);
    try { setPremium(await fetchPremiumCandidateIntelligence(site, { centroid_latitude: draft.position?.latitude ?? center[0], centroid_longitude: draft.position?.longitude ?? center[1] }, site?.analysis_datetime)); }
    catch (requestError) { setError(requestError?.message || "Street-view segmentation unavailable for this location."); }
    finally { setPremiumBusy(false); }
  }

  return <div className={`hs-screen hs-site-map-screen ${drawerOpen ? "drawer-open" : ""}`}>
    <section className="hs-site-summary-card"><span className="hs-site-pin"><MapPin/></span><div className="hs-site-copy"><strong>{site?.name || location?.name || "Selected worksite"}</strong><small>{site?.timezone || location?.timezone || "Timezone unavailable"}</small><em>{site?.address || location?.display_name || "Address unavailable"}</em></div><button type="button" onClick={() => onNavigate("site-setup")}>Change location</button><div className="hs-site-weather"><Sun/><strong>{shown(weatherF, "°F")}</strong><span>{current.condition || "Weather unavailable"}</span></div><dl><div><dt>Feels like</dt><dd>{shown(cToF(current.apparent_temperature_c), "°F")}</dd></div><div><dt>Humidity</dt><dd>{shown(current.relative_humidity_percent, "%")}</dd></div><div><dt>Wind</dt><dd>{shown(mph(current.wind_speed_kmh), " mph")}</dd></div></dl></section>

    {error ? <div className="hs-map-inline-error"><AlertTriangle/><span>{error}</span><button type="button" onClick={() => setError(null)}><X/></button></div> : null}
    <div className="hs-map-workspace">
      <section className="hs-advanced-site-map">
        <div className="hs-map-type-tabs">{[["roadmap","Streets"],["satellite","Satellite"],["terrain","Terrain"]].map(([id,label]) => <button key={id} type="button" className={mapType === id ? "active" : ""} onClick={() => setMapType(id)}>{label}</button>)}</div>
        <div className="hs-map-layer-toggles"><button type="button" className={heatVisible ? "active" : ""} onClick={() => setHeatVisible((value) => !value)}><Thermometer/>Heat Layer <i/></button><button type="button" className={segmentationVisible ? "active" : ""} onClick={toggleSegmentation}><Layers/>{premiumBusy ? "Loading segmentation…" : "Street View Segmentation"}<i/></button><button type="button" disabled title="No defensible shade model is available"><Sun/>Shade / Sun <i/></button></div>
        <GoogleSiteMap site={site} crew={crew} heatFeatures={heatFeatures} heatVisible={heatVisible} mapType={mapType} onMapClick={choosePoint} onWorkerMove={moveWorker} selectedWorkerId={selectedWorkerId} onSelectWorker={setSelectedWorkerId}/>
        <div className="hs-heat-legend"><strong>Heat evidence (°F)</strong><i/><div><span>Cooler</span><span>Moderate</span><span>High</span><span>Highest</span></div><small>{heatFeatures.length ? `FortyGuard · ${heatFeatures.length} mapped cells` : analysisBusy ? "Loading heat evidence…" : "Heat data unavailable"}</small></div>
        {segmentationVisible ? <div className="hs-segmentation-card"><div><strong>Street View Segmentation</strong><small>FortyGuard evidence · not a safety determination</small></div>{premiumBusy ? <LoaderCircle className="spinner"/> : premium?.street_view?.segmented_image_data_uri ? <img src={premium.street_view.segmented_image_data_uri} alt="FortyGuard street-view segmentation"/> : <p>Street-view segmentation unavailable for this location.</p>}</div> : null}
      </section>

      {drawerOpen ? <aside className="hs-worker-drawer"><header><h2>Add Worker</h2><button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close add worker"><X/></button></header><div className="hs-drawer-form">
        <div className="two"><label><span>Worker ID *</span><input value={draft.workerId} onChange={(event) => setField("workerId", event.target.value)}/></label><label><span>Name *</span><input value={draft.name} onChange={(event) => setField("name", event.target.value)} placeholder="Worker name"/></label></div>
        <label><span>Exact location *</span><div className={`hs-location-validation ${inside === false ? "invalid" : inside ? "valid" : ""}`}><MapPin/>{draft.position ? `${draft.position.latitude.toFixed(5)}, ${draft.position.longitude.toFixed(5)}` : "Click inside the site boundary"}{inside ? <Check/> : null}</div></label>
        <label><span>Role / Task *</span><input list="hs-map-task-options" value={draft.currentTask} onChange={(event) => setField("currentTask", event.target.value)}/><datalist id="hs-map-task-options">{TASK_OPTIONS.map((task) => <option key={task} value={task}/>)}</datalist></label>
        <div className="two"><label><span>Shift start *</span><input type="time" value={draft.shiftStart} onChange={(event) => setField("shiftStart", event.target.value)}/></label><label><span>Shift end *</span><input type="time" value={draft.shiftEnd} onChange={(event) => setField("shiftEnd", event.target.value)}/></label></div>
        <label><span>Work environment *</span><select value={draft.directSun ? "sun" : draft.outdoor ? "shade" : "indoor"} onChange={(event) => { const value=event.target.value; setDraft((item) => ({...item,outdoor:value!=="indoor",directSun:value==="sun"})); }}><option value="sun">Outdoor — Full sun</option><option value="shade">Outdoor — Shaded</option><option value="indoor">Indoor / sheltered</option></select></label>
        <div className="two"><label><span>Workload *</span><select value={draft.workload} onChange={(event) => setField("workload", event.target.value)}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label><label><span>Expected exposure *</span><select value={draft.duration} onChange={(event) => setField("duration", Number(event.target.value))}><option value="60">1 hr</option><option value="120">2 hrs</option><option value="240">4 hrs</option><option value="360">6 hrs</option><option value="480">8 hrs</option></select></label></div>
        <label><span>PPE burden *</span><select value={draft.ppe} onChange={(event) => setField("ppe", event.target.value)}><option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option></select></label>
        <label><span>Notes</span><textarea value={draft.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="Work context or exposure notes"/></label>
      </div><footer><button type="button" onClick={() => { setDraft(newDraft(crew)); setDrawerOpen(false); setError(null); }}>Cancel</button><button type="button" onClick={saveWorker}><Check/>Done</button></footer><p><ShieldCheck/>Worker location is stored with the worker record and validated against the site boundary.</p></aside> : <button className="hs-open-worker-drawer" type="button" onClick={() => setDrawerOpen(true)}><Plus/> Add Worker</button>}
    </div>

    <div className="hs-map-bottom-grid"><section className="hs-workers-table"><header><h2>All Workers <span>{crew.length}</span></h2><button type="button" onClick={() => onNavigate("team")}>View all workers</button></header>{crew.length ? <div>{crew.map((worker) => <button key={worker.workerId} type="button" onClick={() => setSelectedWorkerId(worker.workerId)}><span className="hs-worker-avatar">{(worker.name || worker.workerId).slice(0,2).toUpperCase()}</span><span><strong>{worker.workerId}</strong><small>{worker.name}</small></span><span><strong>{worker.currentTask}</strong><small>{worker.zoneLabel}</small></span><em>{BAND_LABEL[cycle?.current_assessment?.screening?.band] || "Pending"}</em><b>Active</b><ChevronRight/></button>)}</div> : <div className="hs-map-empty"><Users/>No workers have been added to this worksite.</div>}</section>
    <section className="hs-worker-plans-list"><header><h2>Worker Plans</h2><button type="button" onClick={() => onNavigate("plan")}>View all plans</button></header>{crew.length && cycle?.agent_decision?.actions?.length ? cycle.agent_decision.actions.map((action) => <button key={action.action_id} type="button" onClick={() => onNavigate("plan")}><ShieldCheck/><span><strong>{humanize(action.action_type)}</strong><small>{humanize(action.status)} · supervisor review</small></span><ChevronRight/></button>) : <div className="hs-map-empty"><ShieldCheck/>Plans appear after worker-specific analysis.</div>}</section></div>
  </div>;
}
