import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Crosshair,
  HardHat,
  MapPin,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

import { createSiteAgentPlan, createSiteSnapshot } from "../../api/sitePlanApi.js";
import { ACTION_COPY, humanize } from "../productUtils.js";

const SITE_STORAGE_KEY = "heatshield.savedSites.v2";
const CREW_STORAGE_KEY = "heatshield.planCrew.v2";
const MAX_AGENT_WORKERS = 10;

const TASK_OPTIONS = [
  "Outdoor field work",
  "Materials move",
  "Equipment inspection",
  "Roof work",
  "Loading / unloading",
  "Indoor support",
  "Documentation / inventory",
];

function readStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Advanced planning still works in-memory when local storage is blocked.
  }
}

function locationLabel(location) {
  const raw = location?.name || location?.city || "Worksite";
  return raw === "Phoenix Central City" ? "Phoenix Yard" : raw;
}

function seedSite(location, id = null) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return {
    id: id || location?.site_id || `SITE-${Date.now()}`,
    name: locationLabel(location),
    city: location?.city || "Phoenix",
    state: location?.state || "Arizona",
    country: "United States",
    timezone: location?.timezone || "America/Phoenix",
    address: location?.display_name || "",
    seedLatitude: Number.isFinite(latitude) ? latitude : 33.4484,
    seedLongitude: Number.isFinite(longitude) ? longitude : -112.074,
    analysis_datetime: location?.analysis_datetime ?? null,
    polygon: [],
    spatialRadiusMeters: 800,
  };
}

function polygonCenter(site) {
  const points = site?.polygon ?? [];
  if (points.length) {
    return [
      points.reduce((sum, point) => sum + Number(point.latitude), 0) / points.length,
      points.reduce((sum, point) => sum + Number(point.longitude), 0) / points.length,
    ];
  }
  return [Number(site?.seedLatitude || 33.4484), Number(site?.seedLongitude || -112.074)];
}

function pointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  const x = Number(point.longitude);
  const y = Number(point.latitude);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i].longitude);
    const yi = Number(polygon[i].latitude);
    const xj = Number(polygon[j].longitude);
    const yj = Number(polygon[j].latitude);
    const intersects = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonAreaAcres(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  const meanLat = polygon.reduce((sum, point) => sum + Number(point.latitude), 0) / polygon.length;
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos((meanLat * Math.PI) / 180);
  let twiceArea = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const x1 = Number(current.longitude) * lonScale;
    const y1 = Number(current.latitude) * latScale;
    const x2 = Number(next.longitude) * lonScale;
    const y2 = Number(next.latitude) * latScale;
    twiceArea += x1 * y2 - x2 * y1;
  }
  const squareMeters = Math.abs(twiceArea) / 2;
  return squareMeters / 4046.8564224;
}

function nextWorkerNumber(crew) {
  const used = new Set(crew.map((worker) => worker.workerId));
  let number = 1;
  while (used.has(`WORKER-${String(number).padStart(2, "0")}`)) number += 1;
  return number;
}

function createWorker(crew) {
  const number = nextWorkerNumber(crew);
  return {
    workerId: `WORKER-${String(number).padStart(2, "0")}`,
    name: `Worker ${String(number).padStart(2, "0")}`,
    zoneId: `ZONE-${String(number).padStart(2, "0")}`,
    zoneLabel: "",
    position: null,
    currentTask: "Outdoor field work",
    workload: "moderate",
    duration: 60,
    ppe: "light",
    outdoor: true,
    directSun: true,
    acclimatized: true,
    reassignAllowed: true,
    alternateTask: "Indoor support",
    alternateWorkload: "light",
    alternateDuration: 45,
    alternateDirectSun: false,
  };
}

function cToF(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number * 9) / 5 + 32) : null;
}

function formatTimestamp(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}

function MapViewport({ site }) {
  const map = useMap();
  useEffect(() => {
    const points = site?.polygon ?? [];
    if (points.length >= 3) {
      map.fitBounds(points.map((point) => [point.latitude, point.longitude]), { padding: [24, 24] });
    } else {
      map.setView(polygonCenter(site), 17);
    }
  }, [map, site?.id, site?.polygon]);
  return null;
}

function MapClickHandler({ onClick }) {
  useMapEvents({
    click(event) {
      onClick({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

function SiteMapEditor({ site, crew, mapMode, activeWorkerId, onMapClick }) {
  const center = polygonCenter(site);
  const polygonPositions = (site?.polygon ?? []).map((point) => [point.latitude, point.longitude]);

  return (
    <div className={`hs-advanced-map mode-${mapMode}`}>
      <MapContainer center={center} zoom={17} scrollWheelZoom className="hs-advanced-leaflet">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapViewport site={site} />
        <MapClickHandler onClick={onMapClick} />
        {polygonPositions.length >= 3 ? (
          <Polygon positions={polygonPositions} pathOptions={{ weight: 3, fillOpacity: 0.12 }} />
        ) : null}
        {polygonPositions.map((position, index) => (
          <CircleMarker key={`vertex-${index}`} center={position} radius={5} pathOptions={{ weight: 2 }}>
            <Tooltip direction="top">Boundary {index + 1}</Tooltip>
          </CircleMarker>
        ))}
        {crew.map((worker, index) => worker.position ? (
          <CircleMarker
            key={worker.workerId}
            center={[worker.position.latitude, worker.position.longitude]}
            radius={activeWorkerId === worker.workerId ? 10 : 8}
            pathOptions={{ weight: activeWorkerId === worker.workerId ? 4 : 2 }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]}>{index + 1}</Tooltip>
          </CircleMarker>
        ) : null)}
      </MapContainer>
      <div className="hs-advanced-map-status">
        {mapMode === "draw" ? "Tap the map around the outside of the full site boundary." : null}
        {mapMode === "worker" ? "Tap inside the site boundary to place the selected worker." : null}
        {mapMode === "idle" ? "Site polygon and worker positions are used as planning evidence inputs." : null}
      </div>
    </div>
  );
}

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
          <input value={worker.zoneLabel} placeholder="e.g. Roof east, Bay 2" onChange={(event) => set("zoneLabel", event.target.value)} />
        </label>
        <button type="button" className={worker.position ? "placed" : ""} onClick={() => onPlace(worker.workerId)}>
          <MapPin size={15} /> {worker.position ? "Move on map" : "Place on map"}
        </button>
      </div>
      <div className="hs-worker-coordinate">{positionText}</div>

      <div className="hs-advanced-worker-grid">
        <label className="wide"><span>Current task</span><input list="hs-task-options" value={worker.currentTask} onChange={(event) => set("currentTask", event.target.value)} /></label>
        <label><span>Workload</span><select value={worker.workload} onChange={(event) => set("workload", event.target.value)}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label>
        <label><span>Exposure</span><select value={worker.duration} onChange={(event) => set("duration", Number(event.target.value))}><option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option><option value={120}>120 min</option></select></label>
        <label><span>PPE</span><select value={worker.ppe} onChange={(event) => set("ppe", event.target.value)}><option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option></select></label>
      </div>

      <div className="hs-worker-toggle-row">
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

function AgentWorkerResult({ result, snapshot, crew }) {
  const workerId = result.worker_id;
  const cycle = result.cycle;
  const configured = crew.find((worker) => worker.workerId === workerId);
  const snapshotWorker = snapshot?.workers?.find((worker) => worker.worker_id === workerId);
  const assessment = cycle?.current_assessment ?? {};
  const environment = assessment?.environmental_evidence ?? {};
  const screening = assessment?.screening ?? {};
  const actions = cycle?.agent_decision?.actions ?? [];
  const schedule = cycle?.shift_optimization?.best_candidate?.assignments ?? [];
  const flags = screening?.contextual_flags ?? [];
  const tempF = cToF(environment.temperature_c);
  const heatIndexF = cToF(environment.heat_index_c);

  return (
    <article className="hs-worker-plan-result">
      <div className="hs-worker-plan-result-head">
        <div><span>{configured?.zoneLabel || snapshotWorker?.zone_id || "Worker area"}</span><h3>{configured?.name || workerId}</h3><small>{workerId}</small></div>
        <div className="hs-worker-risk-badge"><strong>{humanize(screening?.band || "evidence pending")}</strong><span>{tempF === null ? "--" : `${tempF}°F`}{heatIndexF === null ? "" : ` · HI ${heatIndexF}°F`}</span></div>
      </div>

      <p className="hs-worker-thermal-copy">{cycle?.agent_decision?.reasoning_summary?.thermal_interpretation || "Worker-specific provider evidence was assessed before agent selection."}</p>

      <div className="hs-worker-plan-columns">
        <section>
          <span className="eyebrow">WHAT TO DO NOW</span>
          {actions.length ? actions.map((action) => {
            const copy = ACTION_COPY[action.action_type] ?? { title: humanize(action.action_type) };
            return <div className="hs-agent-action" key={action.action_id}><CheckCircle2 size={15} /><div><strong>{copy.title}</strong><small>{action.safe_reason || action.details?.label || "Server-validated agent action"}</small></div></div>;
          }) : <div className="hs-result-empty">Agent status: {humanize(cycle?.agent_decision?.status || "no action selected")}</div>}
        </section>
        <section>
          <span className="eyebrow">WATCH / AVOID</span>
          {flags.length ? flags.map((flag) => <div className="hs-agent-warning" key={flag}><AlertTriangle size={14} /><span>{humanize(flag)}</span></div>) : <div className="hs-result-empty">No extra contextual flags.</div>}
        </section>
      </div>

      <section className="hs-worker-schedule">
        <div className="hs-worker-schedule-title"><Clock3 size={16} /><strong>Time-aware work schedule</strong></div>
        {schedule.length ? schedule.map((item) => (
          <div className="hs-schedule-row" key={`${item.task_id}-${item.candidate_offset_hours}`}>
            <span>{formatTimestamp(item.sampled_local_start_timestamp)}</span>
            <strong>{item.task_name}</strong>
            <em>{cToF(item.sampled_start_temperature_c)}°F sampled</em>
          </div>
        )) : <p>No better flexible schedule was produced from the available FortyGuard forecast samples.</p>}
      </section>
    </article>
  );
}

function PlanResults({ snapshot, agentPlan, crew }) {
  if (!snapshot) return null;
  const usage = snapshot.provider_usage ?? {};
  const summary = snapshot.summary ?? {};
  return (
    <section className="hs-plan-results">
      <div className="hs-plan-results-title"><span>PROVIDER + AGENT PLAN</span><h2>Site intelligence is ready</h2><p>FortyGuard scanned the site area and worker points first. DeepSeek then received bounded, server-validated worker evidence.</p></div>
      <div className="hs-provider-usage-grid">
        <article><strong>{summary.worker_count ?? crew.length}</strong><span>workers assessed</span></article>
        <article><strong>{usage.site_heatmap_requests ?? 0}</strong><span>site heatmap request{usage.site_heatmap_requests === 1 ? "" : "s"}</span></article>
        <article><strong>{usage.worker_environment_fetches ?? 0}</strong><span>worker env fetches</span></article>
        <article><strong>{snapshot.spatial_heat?.summary?.valid_tile_count ?? 0}</strong><span>mapped heat tiles</span></article>
      </div>
      <div className="hs-site-evidence-line"><ShieldCheck size={15} /><span>Site heatmap {snapshot.site_heatmap_activity_id ? "verified" : "fallback"} · {snapshot.site_heatmap_granularity ? `${snapshot.site_heatmap_granularity} m grid` : "point evidence"} · forecast {humanize(summary.forecast_status || "unknown")}</span></div>
      {agentPlan?.results?.length ? (
        <div className="hs-worker-plan-results">
          {agentPlan.results.map((result) => <AgentWorkerResult key={result.worker_id} result={result} snapshot={snapshot} crew={crew} />)}
        </div>
      ) : <div className="hs-result-empty large">The site snapshot is ready, but worker agent plans are not available yet.</div>}
    </section>
  );
}

export default function PlanScreen({ location, setWork }) {
  const initialSites = useMemo(() => {
    const saved = readStorage(SITE_STORAGE_KEY, []);
    return Array.isArray(saved) && saved.length ? saved : [seedSite(location)];
  }, []);
  const initialCrew = useMemo(() => {
    const saved = readStorage(CREW_STORAGE_KEY, []);
    return Array.isArray(saved) ? saved : [];
  }, []);

  const [sites, setSites] = useState(initialSites);
  const [selectedSiteId, setSelectedSiteId] = useState(initialSites[0]?.id ?? null);
  const [crew, setCrew] = useState(initialCrew);
  const [mapMode, setMapMode] = useState("idle");
  const [activeWorkerId, setActiveWorkerId] = useState(null);
  const [busyStage, setBusyStage] = useState(null);
  const [localError, setLocalError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [agentPlan, setAgentPlan] = useState(null);

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? sites[0] ?? null;
  const areaAcres = polygonAreaAcres(selectedSite?.polygon ?? []);

  useEffect(() => writeStorage(SITE_STORAGE_KEY, sites), [sites]);
  useEffect(() => writeStorage(CREW_STORAGE_KEY, crew), [crew]);

  function updateSelectedSite(patch) {
    setSnapshot(null);
    setAgentPlan(null);
    setSites((current) => current.map((site) => site.id === selectedSiteId ? { ...site, ...patch } : site));
  }

  function addCurrentSite() {
    const next = seedSite(location, `SITE-${Date.now()}`);
    next.name = `${locationLabel(location)} ${sites.length + 1}`;
    setSites((current) => [...current, next]);
    setSelectedSiteId(next.id);
    setCrew([]);
    setSnapshot(null);
    setAgentPlan(null);
    setMapMode("draw");
  }

  function removeSelectedSite() {
    if (sites.length <= 1) return;
    const remaining = sites.filter((site) => site.id !== selectedSiteId);
    setSites(remaining);
    setSelectedSiteId(remaining[0]?.id ?? null);
    setCrew([]);
    setSnapshot(null);
    setAgentPlan(null);
  }

  function handleMapClick(point) {
    if (!selectedSite) return;
    if (mapMode === "draw") {
      updateSelectedSite({ polygon: [...(selectedSite.polygon ?? []), point] });
      return;
    }
    if (mapMode === "worker" && activeWorkerId) {
      if (!pointInPolygon(point, selectedSite.polygon)) {
        setLocalError("Worker position must be inside the selected site boundary.");
        return;
      }
      setCrew((current) => current.map((worker) => worker.workerId === activeWorkerId ? { ...worker, position: point } : worker));
      setLocalError(null);
      setMapMode("idle");
      setActiveWorkerId(null);
      setSnapshot(null);
      setAgentPlan(null);
    }
  }

  function updateWorker(index, nextWorker) {
    setCrew((current) => current.map((worker, workerIndex) => workerIndex === index ? nextWorker : worker));
    setSnapshot(null);
    setAgentPlan(null);
  }

  function removeWorker(index) {
    setCrew((current) => current.filter((_, workerIndex) => workerIndex !== index));
    setSnapshot(null);
    setAgentPlan(null);
  }

  function addWorker() {
    if (crew.length >= MAX_AGENT_WORKERS) {
      setLocalError(`Advanced agent planning supports up to ${MAX_AGENT_WORKERS} workers per run.`);
      return;
    }
    const worker = createWorker(crew);
    setCrew((current) => [...current, worker]);
    setActiveWorkerId(worker.workerId);
    setMapMode("worker");
    setLocalError(null);
  }

  function placeWorker(workerId) {
    setActiveWorkerId(workerId);
    setMapMode("worker");
    setLocalError(null);
  }

  const duplicateWorkerIds = new Set(crew.map((worker) => worker.workerId).filter((value, index, all) => all.indexOf(value) !== index));
  const polygonReady = Boolean(selectedSite?.polygon?.length >= 3);
  const workersReady = Boolean(
    crew.length
    && crew.length <= MAX_AGENT_WORKERS
    && crew.every((worker) => (
      worker.workerId.trim()
      && worker.name.trim()
      && worker.zoneLabel.trim()
      && worker.currentTask.trim()
      && worker.position
      && pointInPolygon(worker.position, selectedSite?.polygon ?? [])
    ))
    && !duplicateWorkerIds.size,
  );
  const ready = Boolean(selectedSite && polygonReady && workersReady);

  async function buildAdvancedPlan() {
    if (!ready || busyStage) return;
    setLocalError(null);
    setSnapshot(null);
    setAgentPlan(null);
    try {
      setBusyStage("Scanning full site polygon with FortyGuard…");
      const nextSnapshot = await createSiteSnapshot(selectedSite, crew);
      setSnapshot(nextSnapshot);
      setBusyStage("Running worker-specific bounded AI decisions…");
      const orderedWorkerIds = nextSnapshot.attention_queue?.length
        ? nextSnapshot.attention_queue
        : crew.map((worker) => worker.workerId);
      const nextAgentPlan = await createSiteAgentPlan(nextSnapshot.snapshot_id, orderedWorkerIds);
      setAgentPlan(nextAgentPlan);
      setBusyStage(null);

      const primary = crew[0];
      if (setWork && primary) {
        setWork((current) => ({
          ...current,
          workerId: primary.workerId,
          taskName: primary.currentTask,
          workload: primary.workload,
          duration: primary.duration,
          ppe: primary.ppe,
          directSun: primary.directSun,
          acclimatized: primary.acclimatized,
        }));
      }
    } catch (error) {
      setBusyStage(null);
      setLocalError(error?.message || "The advanced worker plan could not be built.");
    }
  }

  return (
    <div className="hs-screen hs-advanced-plan-screen">
      <datalist id="hs-task-options">{TASK_OPTIONS.map((task) => <option value={task} key={task} />)}</datalist>

      <header className="hs-advanced-plan-title">
        <span>ADVANCED PLAN SETUP</span>
        <h1>Define the real site, then place the real crew</h1>
        <p>HeatShield uses the full site boundary, each worker’s exact position and work context, then asks the bounded agent what should change now and over the next sampled hours.</p>
      </header>

      {localError ? <div className="hs-plan-local-error"><AlertTriangle size={16} /><span>{localError}</span><button type="button" onClick={() => setLocalError(null)}>×</button></div> : null}

      <section className="hs-advanced-card hs-site-library-card">
        <div className="hs-advanced-card-heading"><div><span>1 · SITE LIBRARY</span><h2>Select the worksite you are planning</h2></div><div className="hs-site-library-actions"><button type="button" onClick={addCurrentSite}><Plus size={15} /> Add current worksite</button><button type="button" disabled={sites.length <= 1} onClick={removeSelectedSite}><Trash2 size={15} /></button></div></div>
        <div className="hs-site-selector-grid">
          <label><span>Saved site</span><select value={selectedSiteId ?? ""} onChange={(event) => { setSelectedSiteId(event.target.value); setCrew([]); setSnapshot(null); setAgentPlan(null); setMapMode("idle"); }}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
          <label><span>Site name</span><input value={selectedSite?.name ?? ""} onChange={(event) => updateSelectedSite({ name: event.target.value })} /></label>
        </div>
        <p className="hs-site-address"><MapPin size={14} /> {selectedSite?.address || `${selectedSite?.city}, ${selectedSite?.state}`}</p>
      </section>

      <section className="hs-advanced-card hs-site-boundary-card">
        <div className="hs-advanced-card-heading"><div><span>2 · FULL SITE AREA</span><h2>Draw the whole operational boundary</h2><p>Do not select only one point. The polygon becomes the FortyGuard heatmap AOI and constrains worker positions.</p></div><div className="hs-boundary-meta"><strong>{selectedSite?.polygon?.length ?? 0}</strong><span>vertices</span>{areaAcres !== null ? <em>{areaAcres.toFixed(areaAcres < 10 ? 1 : 0)} acres</em> : null}</div></div>
        {selectedSite ? <SiteMapEditor site={selectedSite} crew={crew} mapMode={mapMode} activeWorkerId={activeWorkerId} onMapClick={handleMapClick} /> : null}
        <div className="hs-map-editor-actions">
          <button type="button" className={mapMode === "draw" ? "active" : ""} onClick={() => { setMapMode(mapMode === "draw" ? "idle" : "draw"); setActiveWorkerId(null); }}><Crosshair size={16} /> {mapMode === "draw" ? "Finish boundary" : "Draw / extend boundary"}</button>
          <button type="button" disabled={!selectedSite?.polygon?.length} onClick={() => updateSelectedSite({ polygon: (selectedSite.polygon ?? []).slice(0, -1) })}><RotateCcw size={16} /> Undo point</button>
          <button type="button" disabled={!selectedSite?.polygon?.length} onClick={() => { updateSelectedSite({ polygon: [] }); setCrew((current) => current.map((worker) => ({ ...worker, position: null }))); }}><Trash2 size={16} /> Clear boundary</button>
        </div>
        <div className={`hs-boundary-readiness ${polygonReady ? "ready" : ""}`}>{polygonReady ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{polygonReady ? "Site area ready for provider heatmap evidence." : "Add at least 3 boundary points before placing workers."}</span></div>
      </section>

      <section className="hs-advanced-card hs-active-crew-card">
        <div className="hs-advanced-card-heading"><div><span>3 · ACTIVE CREW</span><h2>Add only the workers who are on this site now</h2><p>Default is zero workers. Add a worker, place them on the map, then describe the job and any flexible alternate task.</p></div><div className="hs-crew-count"><Users size={17} /><strong>{crew.length}</strong><span>/ {MAX_AGENT_WORKERS}</span></div></div>

        {!crew.length ? (
          <div className="hs-no-workers"><HardHat size={30} /><strong>No workers added yet</strong><p>Add the first worker, then tap inside the site polygon to record where that worker is operating.</p><button type="button" disabled={!polygonReady} onClick={addWorker}><Plus size={17} /> Add first worker</button></div>
        ) : (
          <div className="hs-advanced-worker-list">
            {crew.map((worker, index) => <WorkerEditor key={worker.workerId} worker={worker} index={index} active={activeWorkerId === worker.workerId} onChange={updateWorker} onRemove={removeWorker} onPlace={placeWorker} />)}
            <button className="hs-add-another-worker" type="button" disabled={!polygonReady || crew.length >= MAX_AGENT_WORKERS} onClick={addWorker}><Plus size={17} /> Add another worker</button>
          </div>
        )}
      </section>

      <section className="hs-advanced-card hs-plan-readiness-card">
        <div className="hs-advanced-card-heading"><div><span>4 · READINESS</span><h2>Evidence inputs before the agent runs</h2></div></div>
        <div className="hs-advanced-readiness-grid">
          <article className={polygonReady ? "ready" : ""}><MapPin size={20} /><div><strong>{polygonReady ? "Site polygon ready" : "Site boundary missing"}</strong><span>{areaAcres === null ? "Draw the full site" : `${areaAcres.toFixed(1)} acre AOI`}</span></div></article>
          <article className={workersReady ? "ready" : ""}><Users size={20} /><div><strong>{workersReady ? `${crew.length} workers located` : "Worker setup incomplete"}</strong><span>Exact points + jobs required</span></div></article>
          <article className={crew.some((worker) => worker.reassignAllowed) ? "ready" : ""}><Clock3 size={20} /><div><strong>{crew.filter((worker) => worker.reassignAllowed).length} flexible worker{crew.filter((worker) => worker.reassignAllowed).length === 1 ? "" : "s"}</strong><span>Can use +1/+3/+6/+9/+12h samples</span></div></article>
        </div>
      </section>

      <button className="hs-advanced-build-button" type="button" disabled={!ready || Boolean(busyStage)} onClick={buildAdvancedPlan}>
        <span className="icon"><Sparkles size={22} /></span>
        <span><strong>{busyStage || "BUILD WORKER-SPECIFIC OPERATIONAL PLAN"}</strong><small>{ready ? "FortyGuard polygon heatmap → worker evidence → forecast/shift optimization → bounded DeepSeek actions" : "Finish the site polygon and every worker location first"}</small></span>
        <ArrowRight size={21} />
      </button>

      <PlanResults snapshot={snapshot} agentPlan={agentPlan} crew={crew} />

      <div className="hs-plan-integrity-note"><Save size={14} /><span>Saved sites and crew setup stay in this browser. Provider evidence and agent cycles are generated by the HeatShield backend; no worker temperature or action is invented in the UI.</span></div>
    </div>
  );
}
