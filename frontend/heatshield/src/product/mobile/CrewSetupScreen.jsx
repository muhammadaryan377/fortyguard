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
  activeCandidateZones,
  activeWorkZones,
  createWorker,
  loadCrewMap,
  loadSelectedSiteId,
  loadSites,
  pointInPolygon,
  saveCrewMap,
  workerPositionValid,
  zoneById,
  zoneForPoint,
} from "./planWorkspace.js";
import "./OperationalZones.css";

function normalizeWorkerForSite(worker, site) {
  const workZones = activeWorkZones(site);
  const matched = zoneById(site, worker?.zoneId)
    || zoneForPoint(site, worker?.position, ["work"])
    || workZones[0]
    || null;
  const candidates = activeCandidateZones(site);
  return {
    ...worker,
    zoneId: matched?.id || "",
    zoneLabel: matched?.name || worker?.zoneLabel || "",
    allowedZoneIds: Array.isArray(worker?.allowedZoneIds)
      ? worker.allowedZoneIds.filter((id) => candidates.some((zone) => zone.id === id))
      : candidates.filter((zone) => zone.id !== matched?.id).map((zone) => zone.id),
  };
}

function workerMissingFields(worker, site) {
  const missing = [];
  const assignedZone = zoneById(site, worker.zoneId);
  if (!worker.workerId?.trim()) missing.push("worker ID");
  if (!worker.name?.trim()) missing.push("name");
  if (!assignedZone || !assignedZone.active || assignedZone.type !== "work") missing.push("active work zone");
  if (!workerPositionValid(worker, site)) missing.push("exact point inside assigned zone");
  if (!worker.currentTask?.trim()) missing.push("current task");
  if (!worker.shiftStart || !worker.shiftEnd || worker.shiftEnd <= worker.shiftStart) missing.push("valid shift");
  return missing;
}

function WorkerEditor({ worker, index, site, active, missingFields, onChange, onRemove, onPlace }) {
  const workZones = activeWorkZones(site);
  const candidateZones = activeCandidateZones(site).filter((zone) => zone.id !== worker.zoneId);
  const assignedZone = zoneById(site, worker.zoneId);
  const set = (key, value) => {
    const next = { ...worker, [key]: value };
    if (key === "outdoor" && !value) next.directSun = false;
    onChange(index, next);
  };
  const changeZone = (zoneId) => {
    const zone = zoneById(site, zoneId);
    const positionStillValid = worker.position && zone && pointInPolygon(worker.position, zone.polygon || []);
    onChange(index, {
      ...worker,
      zoneId,
      zoneLabel: zone?.name || "",
      position: positionStillValid ? worker.position : null,
      allowedZoneIds: (worker.allowedZoneIds || []).filter((id) => id !== zoneId),
    });
  };
  const toggleAllowedZone = (zoneId) => {
    const selected = new Set(worker.allowedZoneIds || []);
    if (selected.has(zoneId)) selected.delete(zoneId); else selected.add(zoneId);
    set("allowedZoneIds", [...selected]);
  };
  const positionText = worker.position
    ? `${worker.position.latitude.toFixed(5)}, ${worker.position.longitude.toFixed(5)}`
    : "No precise point recorded";
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
          <span>Assigned work zone</span>
          <select value={worker.zoneId || ""} onChange={(event) => changeZone(event.target.value)}>
            <option value="">Select work zone</option>
            {workZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
          </select>
        </label>
        <button type="button" className={worker.position ? "placed" : ""} disabled={!assignedZone} onClick={() => onPlace(worker.workerId)}>
          <MapPin size={15} /> {worker.position ? "Move worker" : "Place worker"}
        </button>
      </div>
      <div className="hs-worker-coordinate">{positionText} · placement must be inside {assignedZone?.name || "the selected work zone"}.</div>

      {active ? (
        <div className="hs-boundary-readiness">
          <MapPin size={16} />
          <span>Placement active for {worker.name || worker.workerId}. Tap the real worker point inside {assignedZone?.name || "the assigned work zone"}.</span>
        </div>
      ) : null}

      <div className="hs-worker-shift-row">
        <label><span>Shift starts</span><input type="time" value={worker.shiftStart} onChange={(event) => set("shiftStart", event.target.value)} /></label>
        <label><span>Shift ends</span><input type="time" value={worker.shiftEnd} onChange={(event) => set("shiftEnd", event.target.value)} /></label>
        <div className="hs-worker-shift-note"><Clock3 size={14} /><span>Timing alternatives stay inside this worker’s recorded shift.</span></div>
      </div>

      <div className="hs-advanced-worker-grid">
        <label className="wide"><span>Current task</span><input list="hs-task-options" value={worker.currentTask} onChange={(event) => set("currentTask", event.target.value)} /></label>
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
          <div className="hs-zone-alternatives">
            <span>Allowed spatial alternatives</span>
            <div>
              {candidateZones.length ? candidateZones.map((zone) => (
                <button type="button" key={zone.id} className={(worker.allowedZoneIds || []).includes(zone.id) ? "selected" : ""} onClick={() => toggleAllowedZone(zone.id)}>
                  <ShieldCheck size={13} /> {zone.name} · {zone.type}
                </button>
              )) : <small>No other relocation-enabled work/recovery zones are configured.</small>}
            </div>
          </div>
          <div className="hs-alternate-task-row">
            <label className="wide"><span>Alternate task available</span><input list="hs-task-options" value={worker.alternateTask} onChange={(event) => set("alternateTask", event.target.value)} /></label>
            <label><span>Alt. workload</span><select value={worker.alternateWorkload} onChange={(event) => set("alternateWorkload", event.target.value)}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label>
            <label><span>Alt. duration</span><select value={worker.alternateDuration} onChange={(event) => set("alternateDuration", Number(event.target.value))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option></select></label>
          </div>
        </>
      ) : null}

      <div className={`hs-boundary-readiness ${complete ? "ready" : ""}`}>
        {complete ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        <span>{complete ? `Worker ready in ${assignedZone?.name}.` : `Still needed: ${missingFields.join(", ")}.`}</span>
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

  const rawCrew = site ? (crewMap[site.id] ?? []) : [];
  const crew = rawCrew.map((worker) => normalizeWorkerForSite(worker, site));
  const workZones = activeWorkZones(site);
  const polygonReady = Boolean(site?.polygon?.length >= 3 && workZones.length);
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
      setLocalError("Finish the master boundary and at least one active work zone first.");
      return;
    }
    if (crew.length >= MAX_AGENT_WORKERS) {
      setLocalError(`Agent planning supports up to ${MAX_AGENT_WORKERS} workers per run.`);
      return;
    }
    const base = createWorker(crew);
    const firstZone = workZones[0];
    const candidateIds = activeCandidateZones(site).filter((zone) => zone.id !== firstZone.id).map((zone) => zone.id);
    const worker = { ...base, zoneId: firstZone.id, zoneLabel: firstZone.name, allowedZoneIds: candidateIds };
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
    const worker = crew.find((item) => item.workerId === workerId);
    if (!worker?.zoneId) {
      setLocalError("Select a work zone before placing this worker.");
      return;
    }
    setActiveWorkerId(workerId);
    setMapMode("worker");
    setLocalError(null);
  }

  function handleMapClick(point) {
    if (mapMode !== "worker" || !activeWorkerId || !site) return;
    const worker = crew.find((item) => item.workerId === activeWorkerId);
    const zone = zoneById(site, worker?.zoneId);
    if (!pointInPolygon(point, site.polygon || [])) {
      setLocalError("Worker position must stay inside the master site boundary.");
      return;
    }
    if (!zone || !pointInPolygon(point, zone.polygon || [])) {
      setLocalError(`Place ${worker?.name || "the worker"} inside ${zone?.name || "the assigned work zone"}.`);
      return;
    }
    persistCrew(crew.map((item) => item.workerId === activeWorkerId ? { ...item, position: point, zoneLabel: zone.name } : item));
    setMapMode("idle");
    setActiveWorkerId(null);
    setLocalError(null);
  }

  const duplicateIds = new Set(crew.map((worker) => worker.workerId).filter((value, index, all) => all.indexOf(value) !== index));
  const workersReady = Boolean(crew.length && completeWorkerCount === crew.length && !duplicateIds.size);

  function continueToPlan() {
    if (!workersReady) {
      setLocalError("Complete the assigned work zone, exact point, shift and current work for every active worker.");
      return;
    }
    persistCrew(crew);
    onNavigate("plan");
  }

  if (!site || !polygonReady) {
    return (
      <div className="hs-screen hs-advanced-plan-screen">
        <header className="hs-advanced-plan-title"><span>STEP 2 · WORKERS</span><h1>Define the site and its work zones first</h1><p>Worker placement is valid only inside a configured active work zone.</p></header>
        <button className="hs-advanced-build-button" type="button" onClick={() => onNavigate("site-setup")}><span className="icon"><MapPin size={22} /></span><span><strong>GO TO SITE SETUP</strong><small>Draw the master boundary and operational work areas</small></span><ArrowRight size={21} /></button>
      </div>
    );
  }

  return (
    <div className="hs-screen hs-advanced-plan-screen hs-worker-setup-v2">
      <datalist id="hs-task-options">{TASK_OPTIONS.map((task) => <option value={task} key={task} />)}</datalist>

      <header className="hs-advanced-plan-title">
        <span>STEP 2 · WORKER SETUP</span>
        <h1>Add workers and confirm where each person is actually working</h1>
        <p>Assign each worker to a real work zone, place the exact point, and record only the operational context HeatShield needs for planning.</p>
      </header>

      {localError ? <div className="hs-plan-local-error"><AlertTriangle size={16} /><span>{localError}</span><button type="button" onClick={() => setLocalError(null)}>×</button></div> : null}

      <section className="hs-advanced-card hs-crew-site-summary">
        <div className="hs-advanced-card-heading">
          <div><span>SITE SNAPSHOT</span><h2>{site.name}</h2><p>{site.address || `${site.city}, ${site.state}`} · {workZones.length} active work zone{workZones.length === 1 ? "" : "s"}</p></div>
          <button className="hs-small-back-button" type="button" onClick={() => onNavigate("site-setup")}><ArrowLeft size={15} /> Edit site & zones</button>
        </div>
        <PlanMapEditor site={site} crew={crew} mode={mapMode} activeWorkerId={activeWorkerId} onMapClick={handleMapClick} height={300} />
        <div className={`hs-boundary-readiness ${completeWorkerCount === crew.length && crew.length ? "ready" : ""}`}>
          {completeWorkerCount === crew.length && crew.length ? <CheckCircle2 size={16} /> : <MapPin size={16} />}
          <span>{crew.length ? `${completeWorkerCount}/${crew.length} workers complete.` : "Add a worker; HeatShield will ask for the assigned zone and exact point."}</span>
        </div>
      </section>

      <section className="hs-advanced-card hs-active-crew-card">
        <div className="hs-advanced-card-heading">
          <div><span>ACTIVE CREW</span><h2>One worker record = one evidence-backed plan</h2><p>Workers can only be placed inside their assigned work zone. Cooler alternatives are limited to supervisor-approved work/recovery zones.</p></div>
          <div className="hs-crew-count"><Users size={17} /><strong>{crew.length}</strong><span>/ {MAX_AGENT_WORKERS}</span></div>
        </div>

        {!crew.length ? (
          <div className="hs-no-workers"><HardHat size={30} /><strong>No active workers yet</strong><p>Add the first worker and place them in a configured work zone.</p><button type="button" onClick={addWorker}><Plus size={17} /> Add first worker</button></div>
        ) : (
          <div className="hs-advanced-worker-list">
            {crew.map((worker, index) => (
              <WorkerEditor key={worker.workerId} worker={worker} index={index} site={site} active={activeWorkerId === worker.workerId} missingFields={missingByWorker[index]} onChange={updateWorker} onRemove={removeWorker} onPlace={placeWorker} />
            ))}
            <button className="hs-add-another-worker" type="button" disabled={crew.length >= MAX_AGENT_WORKERS} onClick={addWorker}><Plus size={17} /> Add another active worker</button>
          </div>
        )}
      </section>

      <button className="hs-advanced-build-button" type="button" disabled={!workersReady} onClick={continueToPlan}>
        <span className="icon"><CheckCircle2 size={22} /></span>
        <span><strong>CONTINUE TO WORKER PLANS</strong><small>Next: one compact plan screen with FortyGuard evidence, time/space options and supervisor actions</small></span>
        <ArrowRight size={21} />
      </button>

      <p className="hs-worker-privacy-note">Operational context only. HeatShield does not require a worker medical profile.</p>
    </div>
  );
}
