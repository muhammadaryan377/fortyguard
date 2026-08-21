import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  HardHat,
  MapPin,
  Plus,
  ShieldCheck,
  SunMedium,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";

import PlanMapEditor from "./PlanMapEditor.jsx";
import {
  CREW_STORAGE_KEY,
  MAX_AGENT_WORKERS,
  TASK_OPTIONS,
  createWorker,
  loadCrewMap,
  loadSelectedSiteId,
  loadSites,
  pointInPolygon,
  saveCrewMap,
} from "./planWorkspace.js";

function WorkerEditor({ worker, index, active, onChange, onRemove, onPlace }) {
  const set = (key, value) => onChange(index, { ...worker, [key]: value });
  const positionText = worker.position
    ? `${worker.position.latitude.toFixed(5)}, ${worker.position.longitude.toFixed(5)}`
    : "No map position yet";

  return (
    <article className={`hs-advanced-worker ${active ? "is-map-active" : ""}`}>
      <div className="hs-advanced-worker-head">
        <span className="hs-advanced-worker-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="hs-advanced-worker-title">
          <input value={worker.name} onChange={(event) => set("name", event.target.value)} aria-label="Worker name" />
          <span>{worker.workerId}</span>
        </div>
        <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${worker.name}`}><Trash2 size={16} /></button>
      </div>

      <div className="hs-worker-location-row">
        <label>
          <span>Area / zone label</span>
          <input value={worker.zoneLabel} placeholder="e.g. Roof east, Loading bay 2" onChange={(event) => set("zoneLabel", event.target.value)} />
        </label>
        <button type="button" className={worker.position ? "placed" : ""} onClick={() => onPlace(worker.workerId)}>
          <MapPin size={15} /> {worker.position ? "Move on map" : "Place on map"}
        </button>
      </div>
      <div className="hs-worker-coordinate">{positionText}</div>

      <div className="hs-worker-shift-row">
        <label><span>Shift starts</span><input type="time" value={worker.shiftStart} onChange={(event) => set("shiftStart", event.target.value)} /></label>
        <label><span>Shift ends</span><input type="time" value={worker.shiftEnd} onChange={(event) => set("shiftEnd", event.target.value)} /></label>
        <div className="hs-worker-shift-note"><Clock3 size={14} /><span>Used to keep recommendations inside the worker’s active shift.</span></div>
      </div>

      <div className="hs-advanced-worker-grid">
        <label className="wide"><span>Current task</span><input list="hs-task-options" value={worker.currentTask} onChange={(event) => set("currentTask", event.target.value)} /></label>
        <label><span>Workload</span><select value={worker.workload} onChange={(event) => set("workload", event.target.value)}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label>
        <label><span>Exposure</span><select value={worker.duration} onChange={(event) => set("duration", Number(event.target.value))}><option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option><option value={120}>120 min</option></select></label>
        <label><span>PPE</span><select value={worker.ppe} onChange={(event) => set("ppe", event.target.value)}><option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option></select></label>
      </div>

      <div className="hs-worker-toggle-row">
        <button type="button" className={worker.outdoor ? "active" : ""} onClick={() => set("outdoor", !worker.outdoor)}><HardHat size={15} /><span>Outdoor</span><strong>{worker.outdoor ? "Yes" : "No"}</strong></button>
        <button type="button" className={worker.directSun ? "sun active" : "sun"} onClick={() => set("directSun", !worker.directSun)}><SunMedium size={15} /><span>Direct sun</span><strong>{worker.directSun ? "Yes" : "No"}</strong></button>
        <button type="button" className={worker.acclimatized ? "active" : ""} onClick={() => set("acclimatized", !worker.acclimatized)}><UserCheck size={15} /><span>Acclimatized</span><strong>{worker.acclimatized ? "Yes" : "No"}</strong></button>
        <button type="button" className={worker.reassignAllowed ? "active" : ""} onClick={() => set("reassignAllowed", !worker.reassignAllowed)}><ShieldCheck size={15} /><span>Flexible tasks</span><strong>{worker.reassignAllowed ? "Yes" : "No"}</strong></button>
      </div>

      {worker.reassignAllowed ? (
        <div className="hs-alternate-task-row">
          <label className="wide"><span>Alternate task</span><input list="hs-task-options" value={worker.alternateTask} onChange={(event) => set("alternateTask", event.target.value)} /></label>
          <label><span>Alt. workload</span><select value={worker.alternateWorkload} onChange={(event) => set("alternateWorkload", event.target.value)}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label>
          <label><span>Alt. duration</span><select value={worker.alternateDuration} onChange={(event) => set("alternateDuration", Number(event.target.value))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option></select></label>
        </div>
      ) : null}
    </article>
  );
}

export default function CrewSetupScreen({ location, onNavigate }) {
  const sites = useMemo(() => loadSites(location), [location]);
  const selectedSiteId = useMemo(() => loadSelectedSiteId(sites), [sites]);
  const site = sites.find((item) => item.id === selectedSiteId) ?? sites[0] ?? null;
  const initialCrewMap = useMemo(() => loadCrewMap(), []);
  const [crewMap, setCrewMap] = useState(initialCrewMap);
  const [activeWorkerId, setActiveWorkerId] = useState(null);
  const [mapMode, setMapMode] = useState("idle");
  const [localError, setLocalError] = useState(null);

  const crew = site ? (crewMap[site.id] ?? []) : [];
  const polygonReady = Boolean(site?.polygon?.length >= 3);

  function persistCrew(nextCrew) {
    if (!site) return;
    const nextMap = { ...crewMap, [site.id]: nextCrew };
    setCrewMap(nextMap);
    saveCrewMap(nextMap);
  }

  function addWorker() {
    if (!polygonReady) {
      setLocalError("Finish the site boundary before placing workers.");
      return;
    }
    if (crew.length >= MAX_AGENT_WORKERS) {
      setLocalError(`Agent planning supports up to ${MAX_AGENT_WORKERS} workers per run.`);
      return;
    }
    const worker = createWorker(crew);
    persistCrew([...crew, worker]);
    setActiveWorkerId(worker.workerId);
    setMapMode("worker");
    setLocalError(null);
  }

  function updateWorker(index, nextWorker) {
    persistCrew(crew.map((worker, workerIndex) => workerIndex === index ? nextWorker : worker));
  }

  function removeWorker(index) {
    const removing = crew[index];
    persistCrew(crew.filter((_, workerIndex) => workerIndex !== index));
    if (activeWorkerId === removing?.workerId) {
      setActiveWorkerId(null);
      setMapMode("idle");
    }
  }

  function placeWorker(workerId) {
    setActiveWorkerId(workerId);
    setMapMode("worker");
    setLocalError(null);
  }

  function handleMapClick(point) {
    if (mapMode !== "worker" || !activeWorkerId || !site) return;
    if (!pointInPolygon(point, site.polygon)) {
      setLocalError("Worker position must be inside the selected site boundary.");
      return;
    }
    persistCrew(crew.map((worker) => worker.workerId === activeWorkerId ? { ...worker, position: point } : worker));
    setMapMode("idle");
    setActiveWorkerId(null);
    setLocalError(null);
  }

  const duplicateIds = new Set(
    crew.map((worker) => worker.workerId).filter((value, index, all) => all.indexOf(value) !== index),
  );
  const workersReady = Boolean(
    crew.length
    && crew.every((worker) => (
      worker.workerId.trim()
      && worker.name.trim()
      && worker.zoneLabel.trim()
      && worker.currentTask.trim()
      && worker.shiftStart
      && worker.shiftEnd
      && worker.position
      && pointInPolygon(worker.position, site?.polygon ?? [])
    ))
    && !duplicateIds.size,
  );

  function continueToPlan() {
    if (!workersReady) {
      setLocalError("Every worker needs a map position, area label, shift and current task before planning.");
      return;
    }
    onNavigate("plan");
  }

  if (!site || !polygonReady) {
    return (
      <div className="hs-screen hs-advanced-plan-screen">
        <header className="hs-advanced-plan-title"><span>CREW SETUP</span><h1>Define the site before adding workers</h1><p>The worker screen needs a saved site polygon first.</p></header>
        <button className="hs-advanced-build-button" type="button" onClick={() => onNavigate("site-setup")}><span className="icon"><MapPin size={22} /></span><span><strong>GO TO SITE SETUP</strong><small>Select a site and draw its full boundary</small></span><ArrowRight size={21} /></button>
      </div>
    );
  }

  return (
    <div className="hs-screen hs-advanced-plan-screen">
      <datalist id="hs-task-options">{TASK_OPTIONS.map((task) => <option value={task} key={task} />)}</datalist>

      <header className="hs-advanced-plan-title">
        <span>CREW SETUP</span>
        <h1>Place every active worker and describe the work</h1>
        <p>HeatShield will use each worker’s exact site position, shift, exposure and task flexibility when it builds the final plan.</p>
      </header>

      {localError ? <div className="hs-plan-local-error"><AlertTriangle size={16} /><span>{localError}</span><button type="button" onClick={() => setLocalError(null)}>×</button></div> : null}

      <section className="hs-advanced-card hs-crew-site-summary">
        <div className="hs-advanced-card-heading"><div><span>SELECTED SITE</span><h2>{site.name}</h2><p>{site.address || `${site.city}, ${site.state}`}</p></div><button className="hs-small-back-button" type="button" onClick={() => onNavigate("site-setup")}><ArrowLeft size={15} /> Change site</button></div>
        <PlanMapEditor site={site} crew={crew} mode={mapMode} activeWorkerId={activeWorkerId} onMapClick={handleMapClick} height={300} />
      </section>

      <section className="hs-advanced-card hs-active-crew-card">
        <div className="hs-advanced-card-heading"><div><span>ACTIVE CREW</span><h2>Workers on this site right now</h2><p>Start from zero. Add only the people who should receive this operational heat plan.</p></div><div className="hs-crew-count"><Users size={17} /><strong>{crew.length}</strong><span>/ {MAX_AGENT_WORKERS}</span></div></div>

        {!crew.length ? (
          <div className="hs-no-workers"><HardHat size={30} /><strong>No workers added yet</strong><p>Add the first worker, then tap the map to record exactly where they are working.</p><button type="button" onClick={addWorker}><Plus size={17} /> Add first worker</button></div>
        ) : (
          <div className="hs-advanced-worker-list">
            {crew.map((worker, index) => <WorkerEditor key={worker.workerId} worker={worker} index={index} active={activeWorkerId === worker.workerId} onChange={updateWorker} onRemove={removeWorker} onPlace={placeWorker} />)}
            <button className="hs-add-another-worker" type="button" disabled={crew.length >= MAX_AGENT_WORKERS} onClick={addWorker}><Plus size={17} /> Add another worker</button>
          </div>
        )}
      </section>

      <section className="hs-advanced-card hs-plan-readiness-card">
        <div className="hs-advanced-card-heading"><div><span>CREW READINESS</span><h2>Ready for worker-specific planning?</h2></div></div>
        <div className="hs-advanced-readiness-grid">
          <article className="ready"><MapPin size={20} /><div><strong>Site locked</strong><span>{site.name}</span></div></article>
          <article className={workersReady ? "ready" : ""}><Users size={20} /><div><strong>{workersReady ? `${crew.length} workers complete` : "Worker details incomplete"}</strong><span>Map point + shift + job required</span></div></article>
          <article className={crew.some((worker) => worker.reassignAllowed) ? "ready" : ""}><Clock3 size={20} /><div><strong>{crew.filter((worker) => worker.reassignAllowed).length} flexible worker{crew.filter((worker) => worker.reassignAllowed).length === 1 ? "" : "s"}</strong><span>Eligible for time/task reassignment</span></div></article>
        </div>
      </section>

      <button className="hs-advanced-build-button" type="button" disabled={!workersReady} onClick={continueToPlan}>
        <span className="icon"><CheckCircle2 size={22} /></span>
        <span><strong>CONTINUE TO WORKER PLANS</strong><small>FortyGuard will scan the site and each worker position before the agent decides</small></span>
        <ArrowRight size={21} />
      </button>

      <p className="hs-worker-privacy-note">HeatShield stores operational work context only on this setup screen. It does not require a medical profile to build the heat plan.</p>
    </div>
  );
}
