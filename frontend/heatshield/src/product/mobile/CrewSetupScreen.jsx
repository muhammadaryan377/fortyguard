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
  MAX_AGENT_WORKERS,
  TASK_OPTIONS,
  createWorker,
  loadCrewMap,
  loadSelectedSiteId,
  loadSites,
  pointInPolygon,
  saveCrewMap,
} from "./planWorkspace.js";

function workerMissingFields(worker, site) {
  const missing = [];
  if (!worker.workerId?.trim()) missing.push("worker ID");
  if (!worker.name?.trim()) missing.push("name");
  if (!worker.zoneLabel?.trim()) missing.push("area label");
  if (!worker.position || !pointInPolygon(worker.position, site?.polygon ?? [])) missing.push("map position");
  if (!worker.currentTask?.trim()) missing.push("current task");
  if (!worker.shiftStart || !worker.shiftEnd || worker.shiftEnd <= worker.shiftStart) missing.push("valid shift");
  return missing;
}

function WorkerEditor({ worker, index, active, missingFields, onChange, onRemove, onPlace }) {
  const set = (key, value) => {
    const next = { ...worker, [key]: value };
    if (key === "outdoor" && !value) next.directSun = false;
    onChange(index, next);
  };
  const positionText = worker.position
    ? `${worker.position.latitude.toFixed(5)}, ${worker.position.longitude.toFixed(5)}`
    : "No precise map position recorded";
  const complete = !missingFields.length;

  return (
    <article className={`hs-advanced-worker ${active ? "is-map-active" : ""}`}>
      <div className="hs-advanced-worker-head">
        <span className="hs-advanced-worker-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="hs-advanced-worker-title">
          <input value={worker.name} onChange={(event) => set("name", event.target.value)} aria-label="Worker name" />
          <span>{worker.workerId} · {complete ? "ready for planning" : `${missingFields.length} item${missingFields.length === 1 ? "" : "s"} needed`}</span>
        </div>
        <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${worker.name}`}><Trash2 size={16} /></button>
      </div>

      <div className="hs-worker-location-row">
        <label>
          <span>Where is this worker working?</span>
          <input value={worker.zoneLabel} placeholder="e.g. Roof east, Loading bay 2" onChange={(event) => set("zoneLabel", event.target.value)} />
        </label>
        <button type="button" className={worker.position ? "placed" : ""} onClick={() => onPlace(worker.workerId)}>
          <MapPin size={15} /> {worker.position ? "Move worker" : "Place worker"}
        </button>
      </div>
      <div className="hs-worker-coordinate">{positionText} · The agent uses this exact point for worker-specific FortyGuard evidence.</div>

      {active ? (
        <div className="hs-boundary-readiness">
          <MapPin size={16} />
          <span>Placement mode is active for {worker.name || worker.workerId}. Tap the worker’s real work position inside the site boundary above.</span>
        </div>
      ) : null}

      <div className="hs-worker-shift-row">
        <label><span>Shift starts</span><input type="time" value={worker.shiftStart} onChange={(event) => set("shiftStart", event.target.value)} /></label>
        <label><span>Shift ends</span><input type="time" value={worker.shiftEnd} onChange={(event) => set("shiftEnd", event.target.value)} /></label>
        <div className="hs-worker-shift-note"><Clock3 size={14} /><span>The planner only considers future task moves that stay inside this worker’s shift.</span></div>
      </div>

      <div className="hs-advanced-worker-grid">
        <label className="wide"><span>What is the worker doing now?</span><input list="hs-task-options" value={worker.currentTask} onChange={(event) => set("currentTask", event.target.value)} /></label>
        <label><span>Physical workload</span><select value={worker.workload} onChange={(event) => set("workload", event.target.value)}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label>
        <label><span>Expected exposure</span><select value={worker.duration} onChange={(event) => set("duration", Number(event.target.value))}><option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option><option value={120}>120 min</option></select></label>
        <label><span>PPE burden</span><select value={worker.ppe} onChange={(event) => set("ppe", event.target.value)}><option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option></select></label>
      </div>

      <div className="hs-worker-toggle-row">
        <button type="button" className={worker.outdoor ? "active" : ""} onClick={() => set("outdoor", !worker.outdoor)}><HardHat size={15} /><span>Outdoor</span><strong>{worker.outdoor ? "Yes" : "No"}</strong></button>
        <button type="button" disabled={!worker.outdoor} className={worker.directSun ? "sun active" : "sun"} onClick={() => set("directSun", !worker.directSun)}><SunMedium size={15} /><span>Direct sun</span><strong>{worker.directSun ? "Yes" : "No"}</strong></button>
        <button type="button" className={worker.acclimatized ? "active" : ""} onClick={() => set("acclimatized", !worker.acclimatized)}><UserCheck size={15} /><span>Acclimatized</span><strong>{worker.acclimatized ? "Yes" : "No"}</strong></button>
        <button type="button" className={worker.reassignAllowed ? "active" : ""} onClick={() => set("reassignAllowed", !worker.reassignAllowed)}><ShieldCheck size={15} /><span>Can move work</span><strong>{worker.reassignAllowed ? "Yes" : "No"}</strong></button>
      </div>

      {worker.reassignAllowed ? (
        <>
          <div className="hs-alternate-task-row">
            <label className="wide"><span>Safer / alternate task available</span><input list="hs-task-options" value={worker.alternateTask} onChange={(event) => set("alternateTask", event.target.value)} /></label>
            <label><span>Alt. workload</span><select value={worker.alternateWorkload} onChange={(event) => set("alternateWorkload", event.target.value)}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label>
            <label><span>Alt. duration</span><select value={worker.alternateDuration} onChange={(event) => set("alternateDuration", Number(event.target.value))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option></select></label>
          </div>
          <div className="hs-worker-shift-note"><ShieldCheck size={14} /><span>HeatShield may compare this alternate task against sampled future periods. It remains a supervisor-reviewed recommendation, not an automatic reassignment.</span></div>
        </>
      ) : null}

      <div className={`hs-boundary-readiness ${complete ? "ready" : ""}`}>
        {complete ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        <span>{complete ? "Worker input complete: location, shift and work context are ready for the agent." : `Still needed: ${missingFields.join(", ")}.`}</span>
      </div>
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
  const missingByWorker = crew.map((worker) => workerMissingFields(worker, site));
  const completeWorkerCount = missingByWorker.filter((missing) => !missing.length).length;

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
  const workersReady = Boolean(crew.length && completeWorkerCount === crew.length && !duplicateIds.size);

  function continueToPlan() {
    if (!workersReady) {
      setLocalError("Complete the precise map position, area, shift and current work for every active worker before planning.");
      return;
    }
    onNavigate("plan");
  }

  if (!site || !polygonReady) {
    return (
      <div className="hs-screen hs-advanced-plan-screen">
        <header className="hs-advanced-plan-title"><span>STEP 2 · CREW SETUP</span><h1>Define the site before adding workers</h1><p>Worker placement is only valid after the complete site polygon has been saved.</p></header>
        <button className="hs-advanced-build-button" type="button" onClick={() => onNavigate("site-setup")}><span className="icon"><MapPin size={22} /></span><span><strong>GO TO SITE SETUP</strong><small>Select a site and draw its full operational boundary</small></span><ArrowRight size={21} /></button>
      </div>
    );
  }

  return (
    <div className="hs-screen hs-advanced-plan-screen">
      <datalist id="hs-task-options">{TASK_OPTIONS.map((task) => <option value={task} key={task} />)}</datalist>

      <header className="hs-advanced-plan-title">
        <span>STEP 2 · CREW + WORK CONTEXT</span>
        <h1>Put every worker on the map, then describe what they are doing</h1>
        <p>Each worker becomes a separate planning case. HeatShield combines the exact map point with FortyGuard evidence, shift timing, exposure and task flexibility before the agent can recommend anything.</p>
      </header>

      {localError ? <div className="hs-plan-local-error"><AlertTriangle size={16} /><span>{localError}</span><button type="button" onClick={() => setLocalError(null)}>×</button></div> : null}

      <section className="hs-advanced-card hs-crew-site-summary">
        <div className="hs-advanced-card-heading">
          <div><span>1 · VERIFY WORKSITE</span><h2>{site.name}</h2><p>{site.address || `${site.city}, ${site.state}`} · Worker markers must stay inside the saved boundary.</p></div>
          <button className="hs-small-back-button" type="button" onClick={() => onNavigate("site-setup")}><ArrowLeft size={15} /> Change site</button>
        </div>
        <PlanMapEditor site={site} crew={crew} mode={mapMode} activeWorkerId={activeWorkerId} onMapClick={handleMapClick} height={320} />
        <div className={`hs-boundary-readiness ${completeWorkerCount === crew.length && crew.length ? "ready" : ""}`}>
          {completeWorkerCount === crew.length && crew.length ? <CheckCircle2 size={16} /> : <MapPin size={16} />}
          <span>{crew.length ? `${completeWorkerCount}/${crew.length} workers have complete planning inputs.` : "Add a worker below, then the map will enter placement mode for that person."}</span>
        </div>
      </section>

      <section className="hs-advanced-card hs-active-crew-card">
        <div className="hs-advanced-card-heading">
          <div><span>2 · ACTIVE CREW</span><h2>One card = one worker-specific agent plan</h2><p>Add only workers who are active on this site. The required fields are intentionally limited to inputs that affect operational heat planning.</p></div>
          <div className="hs-crew-count"><Users size={17} /><strong>{crew.length}</strong><span>/ {MAX_AGENT_WORKERS}</span></div>
        </div>

        {!crew.length ? (
          <div className="hs-no-workers"><HardHat size={30} /><strong>No active workers yet</strong><p>Add the first worker. HeatShield will immediately ask you to place that worker’s exact location on the site map.</p><button type="button" onClick={addWorker}><Plus size={17} /> Add first worker</button></div>
        ) : (
          <div className="hs-advanced-worker-list">
            {crew.map((worker, index) => (
              <WorkerEditor
                key={worker.workerId}
                worker={worker}
                index={index}
                active={activeWorkerId === worker.workerId}
                missingFields={missingByWorker[index]}
                onChange={updateWorker}
                onRemove={removeWorker}
                onPlace={placeWorker}
              />
            ))}
            <button className="hs-add-another-worker" type="button" disabled={crew.length >= MAX_AGENT_WORKERS} onClick={addWorker}><Plus size={17} /> Add another active worker</button>
          </div>
        )}
      </section>

      <section className="hs-advanced-card hs-plan-readiness-card">
        <div className="hs-advanced-card-heading"><div><span>3 · INPUT CHECK</span><h2>What the planning engine has before it runs</h2><p>The final screen will show these inputs again beside the generated worker plans so the supervisor can audit the reasoning context.</p></div></div>
        <div className="hs-advanced-readiness-grid">
          <article className="ready"><MapPin size={20} /><div><strong>Full site polygon</strong><span>{site.polygon.length} boundary points locked</span></div></article>
          <article className={workersReady ? "ready" : ""}><Users size={20} /><div><strong>{workersReady ? `${crew.length} worker records ready` : `${completeWorkerCount}/${crew.length || 0} workers complete`}</strong><span>Precise point + shift + job + exposure context</span></div></article>
          <article className={crew.some((worker) => worker.reassignAllowed) ? "ready" : ""}><Clock3 size={20} /><div><strong>{crew.filter((worker) => worker.reassignAllowed).length} flexible worker{crew.filter((worker) => worker.reassignAllowed).length === 1 ? "" : "s"}</strong><span>Eligible for sampled time / task comparison</span></div></article>
        </div>
      </section>

      <button className="hs-advanced-build-button" type="button" disabled={!workersReady} onClick={continueToPlan}>
        <span className="icon"><CheckCircle2 size={22} /></span>
        <span><strong>REVIEW INPUTS & GENERATE PLANS</strong><small>Next: verify every worker, scan FortyGuard evidence, then run bounded worker-specific agent decisions</small></span>
        <ArrowRight size={21} />
      </button>

      <p className="hs-worker-privacy-note">HeatShield requests operational work context, not a medical profile. Recommendations remain supervisor-reviewed and evidence-bounded.</p>
    </div>
  );
}
