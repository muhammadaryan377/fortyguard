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
import {
  activeWorkZones,
  cToF,
  formatTimestamp,
  loadCrewMap,
  loadSelectedSiteId,
  loadSites,
  workerPositionValid,
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
    <article className="hs-worker-plan-result hs-selected-worker-plan">
      <div className="hs-worker-plan-result-head">
        <div>
          <span>{attentionOrder ? `PRIORITY ${attentionOrder} · ` : ""}{snapshotWorker?.zone_name || configured?.zoneLabel || "Worker area"}</span>
          <h3>{configured?.name || workerId}</h3>
          <small>{workerId} · {configured?.currentTask || snapshotWorker?.task_name || "Current task"} · shift {shiftLabel(configured)}</small>
        </div>
        <div className="hs-worker-risk-badge">
          <strong>{humanize(screening?.band || "evidence pending")}</strong>
          <span>{tempF === null ? "--" : `${tempF}°F`}{heatIndexF === null ? "" : ` · HI ${heatIndexF}°F`}</span>
        </div>
      </div>

      <div className="hs-plan-input-grid">
        <article className="ready"><MapPin size={18} /><div><strong>{snapshotWorker?.zone_name || configured?.zoneLabel || "Assigned zone"}</strong><span>Exact point inside work zone</span></div></article>
        <article className="ready"><Clock3 size={18} /><div><strong>{shiftLabel(configured)}</strong><span>Active shift window</span></div></article>
        <article className="ready"><Users size={18} /><div><strong>{exposureLabel(configured)}</strong><span>{configured?.ppe ? `${humanize(configured.ppe)} PPE` : "PPE not recorded"}</span></div></article>
      </div>

      <p className="hs-worker-thermal-copy">{reasoning?.thermal_interpretation || "Worker-specific FortyGuard evidence was assessed before bounded agent action selection."}</p>

      <div className="hs-worker-plan-columns">
        <section>
          <span className="eyebrow">DO NOW · SUPERVISOR REVIEW</span>
          {actions.length ? actions.map((action) => {
            const copy = ACTION_COPY[action.action_type] ?? { title: humanize(action.action_type) };
            const trace = toolTrace.find((item) => item.action_id === action.action_id);
            return (
              <div className="hs-agent-action" key={action.action_id}>
                <CheckCircle2 size={15} />
                <div><strong>{copy.title}</strong><small>{trace?.safe_reason || action.details?.label || "Eligible from provider evidence and server guardrails."}</small></div>
              </div>
            );
          }) : <div className="hs-result-empty">Agent status: {humanize(decision?.status || "no action selected")}. No server-approved action was selected.</div>}
        </section>
        <section>
          <span className="eyebrow">WHY THIS WORKER NEEDS ATTENTION</span>
          {flags.length ? flags.map((flag) => <div className="hs-agent-warning" key={flag}><AlertTriangle size={14} /><span>{humanize(flag)}</span></div>) : <div className="hs-result-empty">No additional worker-context flags were raised.</div>}
          <div className="hs-worker-shift-note"><ShieldCheck size={14} /><span>Urgency: {humanize(reasoning?.urgency || "unknown")} · confidence: {humanize(reasoning?.evidence_confidence || "unknown")}</span></div>
        </section>
      </div>

      <section className="hs-worker-schedule">
        <div className="hs-worker-schedule-title"><Clock3 size={16} /><strong>Worker timeline · when to do what</strong></div>
        <div className="hs-schedule-row"><span>{configured?.shiftStart || "--"}</span><strong>Shift begins</strong><em>Planning window opens</em></div>
        <div className="hs-schedule-row"><span>Now</span><strong>{configured?.currentTask || "Current task"}</strong><em>{Number(configured?.duration || 0) || "--"} min expected exposure</em></div>
        {schedule.length ? schedule.map((item) => (
          <div className="hs-schedule-row" key={`${item.task_id}-${item.candidate_offset_hours}`}>
            <span>{formatTimestamp(item.sampled_local_start_timestamp, site?.timezone)}</span>
            <strong>{item.task_name}</strong>
            <em>{cToF(item.sampled_start_temperature_c) === null ? "sample unavailable" : `${cToF(item.sampled_start_temperature_c)}°F sampled`}</em>
          </div>
        )) : <div className="hs-schedule-row"><span>Current plan</span><strong>No better sampled schedule selected</strong><em>Keep supervisor-reviewed current timing</em></div>}
        <div className="hs-schedule-row"><span>{configured?.shiftEnd || "--"}</span><strong>Shift ends</strong><em>Planning boundary</em></div>
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
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [busyStage, setBusyStage] = useState(null);
  const [localError, setLocalError] = useState(null);
  const { site, crew } = setup;
  const workZones = activeWorkZones(site);
  const siteReady = Boolean(site?.polygon?.length >= 3 && workZones.length);
  const crewReady = Boolean(
    crew.length
    && crew.every((worker) => (
      worker.workerId?.trim()
      && worker.name?.trim()
      && worker.currentTask?.trim()
      && worker.shiftStart
      && worker.shiftEnd
      && worker.shiftEnd > worker.shiftStart
      && workerPositionValid(worker, site)
    )),
  );
  const ready = siteReady && crewReady;
  const selectedResult = agentPlan?.results?.find((item) => item.worker_id === selectedWorkerId)
    || agentPlan?.results?.[0]
    || null;

  async function buildPlan() {
    if (!ready || busyStage) return;
    setLocalError(null);
    setSnapshot(null);
    setAgentPlan(null);
    try {
      setBusyStage("Scanning the master site once and extracting worker evidence…");
      const nextSnapshot = await createSiteSnapshot(site, crew);
      setSnapshot(nextSnapshot);
      setBusyStage("Building bounded worker decisions from the fresh site snapshot…");
      const workerIds = nextSnapshot.attention_queue?.length ? nextSnapshot.attention_queue : crew.map((worker) => worker.workerId);
      const nextAgentPlan = await createSiteAgentPlan(nextSnapshot.snapshot_id, workerIds);
      setAgentPlan(nextAgentPlan);
      setSelectedWorkerId(nextAgentPlan.results?.[0]?.worker_id || workerIds[0] || "");
      setBusyStage(null);

      const primary = crew[0];
      if (setWork && primary) {
        setWork((current) => ({ ...current, workerId: primary.workerId, taskName: primary.currentTask, workload: primary.workload, duration: primary.duration, ppe: primary.ppe, directSun: primary.directSun, acclimatized: primary.acclimatized }));
      }
    } catch (error) {
      setBusyStage(null);
      setLocalError(error?.message || "The worker plans could not be built.");
    }
  }

  return (
    <div className="hs-screen hs-worker-plan-screen hs-plan-screen-v2">
      <header className="hs-advanced-plan-title">
        <span>STEP 3 · WORKER PLANS</span>
        <h1>Review plans and approve actions</h1>
        <p>FortyGuard evidence, operational zones and worker context are combined here. Actions remain human-gated.</p>
      </header>

      {localError ? <div className="hs-plan-local-error"><AlertTriangle size={16} /><span>{localError}</span><button type="button" onClick={() => setLocalError(null)}>×</button></div> : null}

      <section className="hs-plan-compact-header">
        <div><span>SITE</span><strong>{site?.name || "No site selected"}</strong><small>{workZones.length} work zone{workZones.length === 1 ? "" : "s"} · {crew.length} active worker{crew.length === 1 ? "" : "s"}</small></div>
        <button type="button" onClick={() => onNavigate("crew-setup")}><Edit3 size={15} /> Edit workers</button>
      </section>

      {!ready ? (
        <section className="hs-plan-empty-gate">
          <ShieldCheck size={30} /><strong>Worker setup is incomplete</strong><p>Finish the site zones and exact worker placements before running provider-backed plans.</p>
          <div><button type="button" onClick={() => onNavigate("site-setup")}><MapPin size={15} /> Edit site</button><button type="button" onClick={() => onNavigate("crew-setup")}><Users size={15} /> Edit workers</button></div>
        </section>
      ) : !agentPlan ? (
        <button className="hs-advanced-build-button" type="button" disabled={Boolean(busyStage)} onClick={buildPlan}>
          <span className="icon"><Sparkles size={22} /></span>
          <span><strong>{busyStage || `GENERATE ${crew.length} WORKER PLAN${crew.length === 1 ? "" : "S"}`}</strong><small>One current master heatmap + shared forecast maps → per-worker tile extraction → bounded agent decisions</small></span>
          <ArrowRight size={21} />
        </button>
      ) : null}

      {snapshot && agentPlan ? (
        <section className="hs-plan-results hs-plan-results-compact">
          <div className="hs-provider-usage-grid">
            <article><strong>{snapshot.summary?.worker_count ?? crew.length}</strong><span>workers assessed</span></article>
            <article><strong>{snapshot.summary?.active_work_zone_count ?? workZones.length}</strong><span>active work zones</span></article>
            <article><strong>{snapshot.provider_usage?.prediction_heatmap_requests ?? 0}</strong><span>forecast map jobs</span></article>
            <article><strong>{snapshot.provider_usage?.spatial_heatmap_requests ?? 0}</strong><span>extra spatial jobs</span></article>
          </div>
          <div className="hs-site-evidence-line"><ShieldCheck size={15} /><span>Master heatmap {snapshot.site_heatmap_activity_id ? "verified" : "fallback"} · forecast {humanize(snapshot.summary?.forecast_status || "unknown")} · zone-bounded spatial {humanize(snapshot.summary?.spatial_status || "unknown")}</span></div>

          <div className="hs-plan-worker-tabs">
            {agentPlan.results.map((result) => {
              const configured = crew.find((worker) => worker.workerId === result.worker_id);
              const snap = snapshot.workers?.find((worker) => worker.worker_id === result.worker_id);
              const band = result.cycle?.current_assessment?.screening?.band;
              return (
                <button type="button" key={result.worker_id} className={(selectedResult?.worker_id === result.worker_id) ? "active" : ""} onClick={() => setSelectedWorkerId(result.worker_id)}>
                  <span>{configured?.name || result.worker_id}</span><small>{snap?.zone_name || configured?.zoneLabel || "Work zone"} · {humanize(band || "pending")}</small>
                </button>
              );
            })}
          </div>

          {selectedResult ? <AgentWorkerResult result={selectedResult} snapshot={snapshot} crew={crew} site={site} /> : null}
          <DecisionWorkbench agentPlan={agentPlan} crew={crew} site={site} selectedWorkerId={selectedResult?.worker_id || ""} onSelectedWorkerChange={setSelectedWorkerId} showWorkerTabs={false} />
        </section>
      ) : null}
    </div>
  );
}
