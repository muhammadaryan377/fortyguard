import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Edit3,
  MapPin,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

import { createSiteAgentPlan, createSiteSnapshot } from "../../api/sitePlanApi.js";
import { ACTION_COPY, humanize } from "../productUtils.js";
import DecisionWorkbench from "./DecisionWorkbench.jsx";
import PlanMapEditor from "./PlanMapEditor.jsx";
import {
  cToF,
  formatTimestamp,
  loadCrewMap,
  loadSelectedSiteId,
  loadSites,
  pointInPolygon,
} from "./planWorkspace.js";

function shiftLabel(worker) {
  if (!worker?.shiftStart || !worker?.shiftEnd) return "Shift not set";
  return `${worker.shiftStart}–${worker.shiftEnd}`;
}

function exposureLabel(worker) {
  const workload = humanize(worker?.workload || "moderate");
  const duration = Number(worker?.duration || 0);
  return `${workload} · ${duration || "--"} min`;
}

function AgentWorkerResult({ result, snapshot, crew, site }) {
  const workerId = result.worker_id;
  const cycle = result.cycle;
  const configured = crew.find((worker) => worker.workerId === workerId);
  const snapshotWorker = snapshot?.workers?.find((worker) => worker.worker_id === workerId);
  const assessment = cycle?.current_assessment ?? {};
  const environment = assessment?.environmental_evidence ?? {};
  const screening = assessment?.screening ?? {};
  const decision = cycle?.agent_decision ?? {};
  const reasoning = decision?.reasoning_summary ?? {};
  const actions = decision?.actions ?? [];
  const toolTrace = decision?.tool_trace ?? [];
  const schedule = cycle?.shift_optimization?.best_candidate?.assignments ?? [];
  const flags = screening?.contextual_flags ?? [];
  const tempF = cToF(environment.temperature_c);
  const heatIndexF = cToF(environment.heat_index_c);
  const attentionOrder = snapshotWorker?.attention_order;

  return (
    <article className="hs-worker-plan-result">
      <div className="hs-worker-plan-result-head">
        <div>
          <span>{attentionOrder ? `PRIORITY ${attentionOrder} · ` : ""}{configured?.zoneLabel || snapshotWorker?.zone_id || "Worker area"}</span>
          <h3>{configured?.name || workerId}</h3>
          <small>{workerId} · {configured?.currentTask || snapshotWorker?.task_name || "Current task"} · shift {shiftLabel(configured)}</small>
        </div>
        <div className="hs-worker-risk-badge">
          <strong>{humanize(screening?.band || "evidence pending")}</strong>
          <span>{tempF === null ? "--" : `${tempF}°F`}{heatIndexF === null ? "" : ` · HI ${heatIndexF}°F`}</span>
        </div>
      </div>

      <div className="hs-plan-input-grid">
        <article className="ready"><Clock3 size={18} /><div><strong>{shiftLabel(configured)}</strong><span>Active shift window</span></div></article>
        <article className="ready"><Users size={18} /><div><strong>{exposureLabel(configured)}</strong><span>{configured?.ppe ? `${humanize(configured.ppe)} PPE` : "PPE not recorded"}</span></div></article>
        <article className={configured?.reassignAllowed ? "ready" : ""}><ShieldCheck size={18} /><div><strong>{configured?.reassignAllowed ? "Flexible work allowed" : "Current work fixed"}</strong><span>{configured?.reassignAllowed ? configured?.alternateTask || "Alternate task available" : "No task reassignment requested"}</span></div></article>
      </div>

      <p className="hs-worker-thermal-copy">
        {reasoning?.thermal_interpretation || "Worker-specific FortyGuard evidence was assessed before agent action selection."}
      </p>

      <div className="hs-worker-plan-columns">
        <section>
          <span className="eyebrow">DO NOW · SUPERVISOR REVIEW</span>
          {actions.length ? actions.map((action) => {
            const copy = ACTION_COPY[action.action_type] ?? { title: humanize(action.action_type) };
            const trace = toolTrace.find((item) => item.action_id === action.action_id);
            return (
              <div className="hs-agent-action" key={action.action_id}>
                <CheckCircle2 size={15} />
                <div>
                  <strong>{copy.title}</strong>
                  <small>{trace?.safe_reason || action.details?.label || "Eligible from current provider evidence and server guardrails."}</small>
                </div>
              </div>
            );
          }) : <div className="hs-result-empty">Agent status: {humanize(decision?.status || "no action selected")}. No server-approved action was selected from the available evidence.</div>}
        </section>

        <section>
          <span className="eyebrow">WHY THIS WORKER NEEDS ATTENTION</span>
          {flags.length ? flags.map((flag) => (
            <div className="hs-agent-warning" key={flag}><AlertTriangle size={14} /><span>{humanize(flag)}</span></div>
          )) : <div className="hs-result-empty">No additional worker-context flags were raised.</div>}
          <div className="hs-worker-shift-note"><ShieldCheck size={14} /><span>Agent urgency: {humanize(reasoning?.urgency || "unknown")} · evidence confidence: {humanize(reasoning?.evidence_confidence || "unknown")}.</span></div>
        </section>
      </div>

      <section className="hs-worker-schedule">
        <div className="hs-worker-schedule-title"><Clock3 size={16} /><strong>Worker timeline · when to do what</strong></div>
        <div className="hs-schedule-row">
          <span>{configured?.shiftStart || "--"}</span>
          <strong>Shift begins</strong>
          <em>Planning window opens</em>
        </div>
        <div className="hs-schedule-row">
          <span>Now</span>
          <strong>{configured?.currentTask || "Current task"}</strong>
          <em>{Number(configured?.duration || 0) || "--"} min expected exposure</em>
        </div>
        {schedule.length ? schedule.map((item) => (
          <div className="hs-schedule-row" key={`${item.task_id}-${item.candidate_offset_hours}`}>
            <span>{formatTimestamp(item.sampled_local_start_timestamp, site?.timezone)}</span>
            <strong>{item.task_name}</strong>
            <em>{cToF(item.sampled_start_temperature_c) === null ? "sample unavailable" : `${cToF(item.sampled_start_temperature_c)}°F sampled`}</em>
          </div>
        )) : (
          <div className="hs-schedule-row">
            <span>Current plan</span>
            <strong>{configured?.reassignAllowed ? "No better sampled move found" : "Keep current task timing"}</strong>
            <em>{configured?.reassignAllowed ? "Forecast samples did not produce a better candidate" : "Worker marked non-flexible"}</em>
          </div>
        )}
        <div className="hs-schedule-row">
          <span>{configured?.shiftEnd || "--"}</span>
          <strong>Shift ends</strong>
          <em>Planning boundary</em>
        </div>
      </section>
    </article>
  );
}

export default function PlanScreen({ location, onNavigate, setWork }) {
  const setup = useMemo(() => {
    const sites = loadSites(location);
    const selectedSiteId = loadSelectedSiteId(sites);
    const site = sites.find((item) => item.id === selectedSiteId) ?? sites[0] ?? null;
    const crewMap = loadCrewMap();
    return { site, crew: site ? (crewMap[site.id] ?? []) : [] };
  }, [location]);

  const [snapshot, setSnapshot] = useState(null);
  const [agentPlan, setAgentPlan] = useState(null);
  const [busyStage, setBusyStage] = useState(null);
  const [localError, setLocalError] = useState(null);

  const { site, crew } = setup;
  const siteReady = Boolean(site?.polygon?.length >= 3);
  const crewReady = Boolean(
    crew.length
    && crew.every((worker) => (
      worker.workerId?.trim()
      && worker.name?.trim()
      && worker.zoneLabel?.trim()
      && worker.currentTask?.trim()
      && worker.shiftStart
      && worker.shiftEnd
      && worker.shiftEnd > worker.shiftStart
      && worker.position
      && pointInPolygon(worker.position, site?.polygon ?? [])
    )),
  );
  const ready = siteReady && crewReady;
  const flexibleCount = crew.filter((worker) => worker.reassignAllowed).length;

  async function buildPlan() {
    if (!ready || busyStage) return;
    setLocalError(null);
    setSnapshot(null);
    setAgentPlan(null);
    try {
      setBusyStage("Scanning site + every worker point with FortyGuard…");
      const nextSnapshot = await createSiteSnapshot(site, crew);
      setSnapshot(nextSnapshot);
      setBusyStage("Building worker plans in evidence-priority order…");
      const workerIds = nextSnapshot.attention_queue?.length
        ? nextSnapshot.attention_queue
        : crew.map((worker) => worker.workerId);
      const nextAgentPlan = await createSiteAgentPlan(nextSnapshot.snapshot_id, workerIds);
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
      setLocalError(error?.message || "The worker-specific plan could not be built.");
    }
  }

  return (
    <div className="hs-screen hs-worker-plan-screen">
      <header className="hs-advanced-plan-title">
        <span>STEP 3 · REVIEW + GENERATE</span>
        <h1>Verify who is where and what they are doing before the agent plans</h1>
        <p>This is the supervisor checkpoint. HeatShield shows the exact site, worker locations, shifts and jobs it will send into FortyGuard-backed planning, then returns a separate time-aware plan for every worker.</p>
      </header>

      {localError ? (
        <div className="hs-plan-local-error"><AlertTriangle size={16} /><span>{localError}</span><button type="button" onClick={() => setLocalError(null)}>×</button></div>
      ) : null}

      <section className="hs-advanced-card hs-plan-input-summary">
        <div className="hs-advanced-card-heading">
          <div><span>1 · PLAN SCOPE</span><h2>{site?.name || "No worksite selected"}</h2><p>{site?.address || (site ? `${site.city}, ${site.state}` : "Choose a worksite")} · {crew.length} active worker{crew.length === 1 ? "" : "s"}</p></div>
          <div className="hs-plan-edit-actions">
            <button type="button" onClick={() => onNavigate("site-setup")}><MapPin size={15} /> Edit site</button>
            <button type="button" onClick={() => onNavigate("crew-setup")}><Users size={15} /> Edit workers</button>
          </div>
        </div>

        <div className="hs-plan-input-grid">
          <article className={siteReady ? "ready" : ""}><MapPin size={20} /><div><strong>{siteReady ? "Full site area locked" : "Site setup needed"}</strong><span>{siteReady ? `${site.polygon.length} boundary points` : "Draw the complete site polygon"}</span></div></article>
          <article className={crewReady ? "ready" : ""}><Users size={20} /><div><strong>{crewReady ? `${crew.length} precise worker records` : "Worker setup needed"}</strong><span>Exact point + shift + current job for each worker</span></div></article>
          <article className={flexibleCount ? "ready" : ""}><Clock3 size={20} /><div><strong>{flexibleCount} flexible worker{flexibleCount === 1 ? "" : "s"}</strong><span>Can be compared across sampled task / time options</span></div></article>
        </div>

        {site ? <PlanMapEditor site={site} crew={crew} mode="idle" height={300} /> : null}
      </section>

      {crew.length ? (
        <section className="hs-advanced-card hs-active-crew-card">
          <div className="hs-advanced-card-heading"><div><span>2 · WORKER INPUT REVIEW</span><h2>What the agent will know about each person’s work</h2><p>Check the location and operational context now. The generated plan will preserve this worker-by-worker structure.</p></div><div className="hs-crew-count"><Users size={17} /><strong>{crew.length}</strong><span>workers</span></div></div>
          <div className="hs-advanced-worker-list">
            {crew.map((worker, index) => {
              const pointReady = Boolean(worker.position && pointInPolygon(worker.position, site?.polygon ?? []));
              return (
                <article className="hs-worker-plan-result" key={worker.workerId}>
                  <div className="hs-worker-plan-result-head">
                    <div>
                      <span>WORKER {String(index + 1).padStart(2, "0")} · {worker.zoneLabel || "Area not set"}</span>
                      <h3>{worker.name}</h3>
                      <small>{worker.workerId} · {worker.position ? `${worker.position.latitude.toFixed(5)}, ${worker.position.longitude.toFixed(5)}` : "No map point"}</small>
                    </div>
                    <div className="hs-worker-risk-badge"><strong>{worker.currentTask || "Task missing"}</strong><span>{exposureLabel(worker)}</span></div>
                  </div>
                  <div className="hs-plan-input-grid">
                    <article className={pointReady ? "ready" : ""}><MapPin size={18} /><div><strong>{worker.zoneLabel || "Location incomplete"}</strong><span>{pointReady ? "Exact point inside site" : "Place worker inside site"}</span></div></article>
                    <article className={worker.shiftStart && worker.shiftEnd > worker.shiftStart ? "ready" : ""}><Clock3 size={18} /><div><strong>{shiftLabel(worker)}</strong><span>Shift planning window</span></div></article>
                    <article className="ready"><ShieldCheck size={18} /><div><strong>{worker.outdoor ? (worker.directSun ? "Outdoor · direct sun" : "Outdoor · no direct sun") : "Indoor / sheltered"}</strong><span>{humanize(worker.ppe)} PPE · {worker.acclimatized ? "acclimatized" : "not acclimatized"}</span></div></article>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {!ready ? (
        <section className="hs-plan-empty-gate">
          <ShieldCheck size={30} />
          <strong>Complete the operational inputs before generating plans</strong>
          <p>HeatShield will not invent a site boundary, worker position, shift or task. Fix the incomplete setup first so the agent is reasoning from explicit supervisor inputs.</p>
          <div><button type="button" onClick={() => onNavigate("site-setup")}><Edit3 size={15} /> Set up site</button><button type="button" onClick={() => onNavigate("crew-setup")}><Users size={15} /> Set up workers</button></div>
        </section>
      ) : (
        <button className="hs-advanced-build-button" type="button" disabled={Boolean(busyStage)} onClick={buildPlan}>
          <span className="icon"><Sparkles size={22} /></span>
          <span><strong>{busyStage || `GENERATE ${crew.length} WORKER PLAN${crew.length === 1 ? "" : "S"}`}</strong><small>Full site polygon → worker-specific FortyGuard evidence → sampled forecast/shift comparison → bounded agent actions</small></span>
          <ArrowRight size={21} />
        </button>
      )}

      {snapshot ? (
        <section className="hs-plan-results">
          <div className="hs-plan-results-title">
            <span>3 · FORTYGUARD + AGENT OUTPUT</span>
            <h2>Operational plans are ordered by worker attention priority</h2>
            <p>Every plan below refreshes evidence at that worker’s submitted coordinates. Actions remain human-gated; HeatShield does not silently move workers or execute controls.</p>
          </div>

          <div className="hs-provider-usage-grid">
            <article><strong>{snapshot.summary?.worker_count ?? crew.length}</strong><span>workers assessed</span></article>
            <article><strong>{cToF(snapshot.shared_environment?.temperature_c) ?? "--"}{cToF(snapshot.shared_environment?.temperature_c) === null ? "" : "°F"}</strong><span>shared site temperature</span></article>
            <article><strong>{snapshot.provider_usage?.worker_environment_fetches ?? 0}</strong><span>worker evidence fetches</span></article>
            <article><strong>{snapshot.spatial_heat?.summary?.valid_tile_count ?? 0}</strong><span>mapped heat tiles</span></article>
          </div>

          <div className="hs-site-evidence-line">
            <ShieldCheck size={15} />
            <span>Site heatmap {snapshot.site_heatmap_activity_id ? "verified" : "fallback"} · {snapshot.site_heatmap_granularity ? `${snapshot.site_heatmap_granularity} m grid` : "point evidence"} · forecast {humanize(snapshot.summary?.forecast_status || "unknown")} · spatial {humanize(snapshot.summary?.spatial_status || "unknown")}</span>
          </div>

          {agentPlan?.results?.length ? (
            <>
              <div className="hs-worker-plan-results">
                {agentPlan.results.map((result) => <AgentWorkerResult key={result.worker_id} result={result} snapshot={snapshot} crew={crew} site={site} />)}
              </div>
              <DecisionWorkbench agentPlan={agentPlan} crew={crew} site={site} />
            </>
          ) : <div className="hs-result-empty large">The site scan is ready; worker agent plans are still being prepared.</div>}
        </section>
      ) : null}
    </div>
  );
}
