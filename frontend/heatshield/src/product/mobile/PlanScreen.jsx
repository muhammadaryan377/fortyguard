import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Crosshair,
  HardHat,
  Map,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";

const PLAN_STORAGE_KEY = "heatshield.plan.setup.v1";

const ZONES = [
  { value: "north_side", label: "North side" },
  { value: "south_side", label: "South side" },
  { value: "loading_zone", label: "Loading zone" },
  { value: "roof_edge", label: "Roof edge" },
];

const TASKS = [
  { value: "Outdoor field work", label: "Outdoor field" },
  { value: "Materials move", label: "Materials move" },
  { value: "Equipment check", label: "Equipment check" },
  { value: "Inspection", label: "Inspection" },
  { value: "Indoor support", label: "Indoor support" },
];

const DEFAULT_CREW = [
  {
    workerId: "WORKER-01",
    name: "Worker 01",
    zone: "north_side",
    currentTask: "Outdoor field work",
    alternateTask: "Materials move",
    workload: "moderate",
    duration: 60,
    ppe: "light",
    directSun: true,
    acclimatized: true,
    reassignAllowed: true,
  },
  {
    workerId: "WORKER-02",
    name: "Worker 02",
    zone: "loading_zone",
    currentTask: "Outdoor field work",
    alternateTask: "Equipment check",
    workload: "heavy",
    duration: 45,
    ppe: "moderate",
    directSun: true,
    acclimatized: false,
    reassignAllowed: true,
  },
  {
    workerId: "WORKER-03",
    name: "Worker 03",
    zone: "south_side",
    currentTask: "Materials move",
    alternateTask: "Inspection",
    workload: "moderate",
    duration: 30,
    ppe: "light",
    directSun: false,
    acclimatized: true,
    reassignAllowed: true,
  },
];

function zoneLabel(value) {
  return ZONES.find((zone) => zone.value === value)?.label ?? "Unassigned";
}

function readSavedSetup() {
  try {
    const raw = window.sessionStorage.getItem(PLAN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.crew) || !parsed.crew.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function createWorker(index, fallbackZone = "north_side") {
  const number = index + 1;
  return {
    workerId: `WORKER-${String(number).padStart(2, "0")}`,
    name: `Worker ${String(number).padStart(2, "0")}`,
    zone: fallbackZone,
    currentTask: "Outdoor field work",
    alternateTask: "Materials move",
    workload: "moderate",
    duration: 60,
    ppe: "light",
    directSun: true,
    acclimatized: true,
    reassignAllowed: true,
  };
}

function WorkerCard({ worker, index, canRemove, onChange, onRemove }) {
  const set = (key, value) => onChange(index, { ...worker, [key]: value });

  return (
    <article className={`hs-crew-worker-card ${index === 0 ? "is-active" : ""}`}>
      <div className="hs-crew-worker-identity">
        <span className="hs-crew-worker-number">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <input
            className="hs-crew-worker-name"
            value={worker.name}
            aria-label={`Worker ${index + 1} display name`}
            onChange={(event) => set("name", event.target.value)}
          />
          <select
            className="hs-crew-zone-select"
            value={worker.zone}
            aria-label={`${worker.name} assigned work area`}
            onChange={(event) => set("zone", event.target.value)}
          >
            {ZONES.map((zone) => <option value={zone.value} key={zone.value}>{zone.label}</option>)}
          </select>
        </div>
        <button
          className="hs-crew-remove"
          type="button"
          aria-label={`Remove ${worker.name}`}
          title="Remove worker"
          disabled={!canRemove}
          onClick={() => onRemove(index)}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="hs-crew-worker-fields">
        <label className="hs-crew-field task-field">
          <span>Current task</span>
          <select value={worker.currentTask} onChange={(event) => set("currentTask", event.target.value)}>
            {TASKS.map((task) => <option value={task.value} key={task.value}>{task.label}</option>)}
          </select>
        </label>
        <label className="hs-crew-field">
          <span>Workload</span>
          <select value={worker.workload} onChange={(event) => set("workload", event.target.value)}>
            <option value="light">Light</option>
            <option value="moderate">Moderate</option>
            <option value="heavy">Heavy</option>
            <option value="very_heavy">Very heavy</option>
          </select>
        </label>
        <label className="hs-crew-field">
          <span>Exposure</span>
          <select value={worker.duration} onChange={(event) => set("duration", Number(event.target.value))}>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={45}>45 min</option>
            <option value={60}>60 min</option>
            <option value={90}>90 min</option>
            <option value={120}>120 min</option>
          </select>
        </label>
        <label className="hs-crew-field">
          <span>PPE</span>
          <select value={worker.ppe} onChange={(event) => set("ppe", event.target.value)}>
            <option value="none">None</option>
            <option value="light">Light</option>
            <option value="moderate">Moderate</option>
            <option value="heavy">Heavy</option>
          </select>
        </label>
      </div>

      <div className="hs-crew-worker-options">
        <button
          type="button"
          className={worker.directSun ? "hs-crew-toggle sun active" : "hs-crew-toggle sun"}
          onClick={() => set("directSun", !worker.directSun)}
        >
          <SunMedium size={15} />
          <span>Direct sun</span>
          <strong>{worker.directSun ? "Yes" : "No"}</strong>
        </button>
        <button
          type="button"
          className={worker.acclimatized ? "hs-crew-toggle active" : "hs-crew-toggle"}
          onClick={() => set("acclimatized", !worker.acclimatized)}
        >
          <UserCheck size={15} />
          <span>Acclimatized</span>
          <strong>{worker.acclimatized ? "Yes" : "No"}</strong>
        </button>
        <label className="hs-crew-alt-task">
          <span>Alternate task</span>
          <select
            value={worker.alternateTask}
            disabled={!worker.reassignAllowed}
            onChange={(event) => set("alternateTask", event.target.value)}
          >
            {TASKS.map((task) => <option value={task.value} key={task.value}>{task.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          className={worker.reassignAllowed ? "hs-crew-toggle reassign active" : "hs-crew-toggle reassign"}
          onClick={() => set("reassignAllowed", !worker.reassignAllowed)}
        >
          <ShieldCheck size={15} />
          <span>Reassign</span>
          <strong>{worker.reassignAllowed ? "Allowed" : "Locked"}</strong>
        </button>
      </div>
    </article>
  );
}

export default function PlanScreen({
  location,
  cycle,
  setWork,
  onNavigate,
  onUseCurrentLocation,
}) {
  const saved = useMemo(() => readSavedSetup(), []);
  const [selectedZone, setSelectedZone] = useState(saved?.selectedZone ?? "north_side");
  const [crew, setCrew] = useState(saved?.crew ?? DEFAULT_CREW);
  const [confirmed, setConfirmed] = useState(false);

  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  const siteName = location?.name || location?.city || "Select worksite";

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        PLAN_STORAGE_KEY,
        JSON.stringify({ selectedZone, crew, savedAt: new Date().toISOString() }),
      );
    } catch {
      // The screen still works if browser storage is unavailable.
    }
  }, [selectedZone, crew]);

  const assignedCount = crew.filter((worker) => worker.zone && worker.currentTask).length;
  const directSunCount = crew.filter((worker) => worker.directSun).length;
  const uniqueZones = new Set(crew.map((worker) => worker.zone).filter(Boolean)).size;
  const ready = Boolean(
    hasCoordinates &&
    crew.length &&
    crew.every((worker) => (
      worker.workerId.trim() &&
      worker.name.trim() &&
      worker.zone &&
      worker.currentTask &&
      worker.workload &&
      Number(worker.duration) > 0 &&
      worker.ppe
    )),
  );

  function updateWorker(index, nextWorker) {
    setConfirmed(false);
    setCrew((current) => current.map((worker, workerIndex) => (
      workerIndex === index ? nextWorker : worker
    )));
  }

  function addWorker() {
    setConfirmed(false);
    setCrew((current) => [
      ...current,
      createWorker(current.length, selectedZone || "north_side"),
    ]);
  }

  function removeWorker(index) {
    setConfirmed(false);
    setCrew((current) => current.filter((_, workerIndex) => workerIndex !== index));
  }

  function decreaseCrew() {
    if (crew.length <= 1) return;
    removeWorker(crew.length - 1);
  }

  function handleBuildSetup() {
    if (!ready) return;
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

    try {
      window.sessionStorage.setItem(
        PLAN_STORAGE_KEY,
        JSON.stringify({
          selectedZone,
          crew,
          site: {
            siteId: location?.site_id ?? null,
            name: siteName,
            latitude,
            longitude,
            timezone: location?.timezone ?? null,
          },
          savedAt: new Date().toISOString(),
          ready: true,
        }),
      );
    } catch {
      // Continue with in-memory state.
    }

    setConfirmed(true);
  }

  return (
    <div className="hs-screen hs-plan-setup-screen">
      <header className="hs-plan-setup-title">
        <span>PLAN SETUP</span>
        <h1>Set the exact worksite and active crew</h1>
        <p>Confirm the site, choose the work area, and assign each worker before HeatShield builds worker-specific guidance.</p>
      </header>

      <section className="hs-plan-setup-card hs-plan-worksite-card">
        <div className="hs-plan-card-heading">
          <div>
            <span>WORKSITE</span>
            <h2>Confirm the site and work area</h2>
          </div>
        </div>

        <div className="hs-plan-site-grid">
          <div className="hs-plan-site-copy">
            <div className="hs-plan-site-name"><MapPin size={19} /><strong>{siteName}</strong></div>
            <p>{location?.display_name || "Choose an exact supported worksite before building the crew plan."}</p>
          </div>
          <div className="hs-plan-mini-map" aria-label="Stylized worksite preview">
            <span className="shape building one" />
            <span className="shape building two" />
            <span className="shape green one" />
            <span className="shape green two" />
            <span className="hs-plan-zone-outline" />
            <span className="hs-plan-map-pin"><MapPin size={23} /></span>
          </div>
        </div>

        <div className="hs-plan-zone-chips" role="group" aria-label="Worksite areas">
          {ZONES.map((zone) => (
            <button
              key={zone.value}
              type="button"
              className={selectedZone === zone.value ? "active" : ""}
              onClick={() => {
                setConfirmed(false);
                setSelectedZone(zone.value);
              }}
            >
              {selectedZone === zone.value ? <CheckCircle2 size={15} /> : null}
              {zone.label}
            </button>
          ))}
        </div>

        <div className="hs-plan-site-actions">
          <button type="button" onClick={() => onNavigate("map")}><Map size={17} /> Choose on Map</button>
          <button type="button" className="primary" onClick={onUseCurrentLocation}><Crosshair size={17} /> Use current site</button>
        </div>

        <div className="hs-plan-coordinate-line">
          <MapPin size={14} />
          <span>{hasCoordinates ? `Lat ${latitude.toFixed(4)}, Lon ${longitude.toFixed(4)}` : "Exact coordinates required"}</span>
          <strong>{zoneLabel(selectedZone)}</strong>
        </div>
      </section>

      <section className="hs-plan-setup-card hs-plan-crew-card">
        <div className="hs-plan-crew-heading">
          <div>
            <span>ACTIVE CREW</span>
            <h2>Who is working right now?</h2>
            <p>Assign each worker to the area they are covering so HeatShield can tailor actions by exposure.</p>
          </div>
          <div className="hs-plan-worker-counter" aria-label={`${crew.length} workers on site`}>
            <button type="button" disabled={crew.length <= 1} onClick={decreaseCrew}><Minus size={16} /></button>
            <strong>{crew.length} worker{crew.length === 1 ? "" : "s"} on site</strong>
            <button type="button" onClick={addWorker}><Plus size={16} /></button>
          </div>
        </div>

        <div className="hs-crew-roster">
          {crew.map((worker, index) => (
            <WorkerCard
              key={`${worker.workerId}-${index}`}
              worker={worker}
              index={index}
              canRemove={crew.length > 1}
              onChange={updateWorker}
              onRemove={removeWorker}
            />
          ))}
        </div>

        <button className="hs-plan-add-worker" type="button" onClick={addWorker}>
          <Plus size={17} /> Add worker
        </button>
      </section>

      <section className="hs-plan-setup-card hs-plan-readiness-summary">
        <div className="hs-plan-card-heading"><div><span>READINESS SUMMARY</span></div></div>
        <div className="hs-plan-readiness-grid">
          <article className={hasCoordinates ? "ready" : ""}>
            <CheckCircle2 size={23} />
            <div><strong>{hasCoordinates ? "Site ready" : "Site needed"}</strong><span>{siteName}</span></div>
          </article>
          <article className={assignedCount === crew.length ? "ready blue" : ""}>
            <Users size={23} />
            <div><strong>{assignedCount} worker{assignedCount === 1 ? "" : "s"} assigned</strong><span>{uniqueZones} active zone{uniqueZones === 1 ? "" : "s"}</span></div>
          </article>
          <article className={directSunCount ? "sun" : "ready"}>
            <SunMedium size={23} />
            <div><strong>{directSunCount} direct-sun worker{directSunCount === 1 ? "" : "s"}</strong><span>Needs exposure-aware planning</span></div>
          </article>
        </div>
        <p>Next, HeatShield will build per-worker heat actions using the selected site, zone, current task, alternate task, and crew assignments.</p>
        {cycle?.current_assessment ? (
          <div className="hs-plan-evidence-ready"><ShieldCheck size={15} /> Site heat evidence is already available for the planning stage.</div>
        ) : null}
      </section>

      {confirmed ? (
        <section className="hs-plan-context-confirmed">
          <HardHat size={21} />
          <div>
            <strong>Crew context captured</strong>
            <p>{crew.length} worker profiles are ready. No multi-worker AI recommendation is being fabricated yet; the next implementation step will run a bounded provider-backed cycle for each worker.</p>
          </div>
        </section>
      ) : null}

      <button
        className="hs-plan-build-crew"
        type="button"
        disabled={!ready}
        onClick={handleBuildSetup}
      >
        <span className="hs-plan-build-icon"><Sparkles size={22} /></span>
        <span>
          <strong>{confirmed ? "CREW CONTEXT READY" : "BUILD WORKER-SPECIFIC PLAN"}</strong>
          <small>{ready ? "Use site, zone, tasks and crew context to create tailored actions" : "Complete the exact site and every worker assignment first"}</small>
        </span>
        <ArrowRight size={21} />
      </button>
    </div>
  );
}
