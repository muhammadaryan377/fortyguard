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
import {
  cToF,
  formatTimestamp,
  loadCrewMap,
  loadSelectedSiteId,
  loadSites,
  pointInPolygon,
} from "./planWorkspace.js";

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
        <div>
          <span>{configured?.zoneLabel || snapshotWorker?.zone_id || "Worker area"}</span>
          <h3>{configured?.name || workerId}</h3>
          <small>{workerId} · {configured?.currentTask || snapshotWorker?.task_name || "Current task"}</small>
        </div>
        <div className="hs-worker-risk-badge">
          <strong>{humanize(screening?.band || "evidence pending")}</strong>
          <span>{tempF === null ? "--" : `${tempF}°F`}{heatIndexF === null ? "" : ` · HI ${heatIndexF}°F`}</span>
        </div>
      </div>

      <p className="hs-worker-thermal-copy">
        {cycle?.agent_decision?.reasoning_summary?.thermal_interpretation || "Worker-specific provider evidence was assessed before agent selection."}
      </p>

      <div className="hs-worker-plan-columns">
        <section>
          <span className="eyebrow">WHAT TO DO NOW</span>
          {actions.length ? actions.map((action) => {
            const copy = ACTION_COPY[action.action_type] ?? { title: humanize(action.action_type) };
            return (
              <div className="hs-agent-action" key={action.action_id}>
                <CheckCircle2 size={15} />
                <div>
                  <strong>{copy.title}</strong>
                  <small>{action.safe_reason || action.details?.label || "Server-validated agent action"}</small>
                </div>
              </div>
            );
          }) : <div className="hs-result-empty">Agent status: {humanize(cycle?.agent_decision?.status || "no action selected")}</div>}
        </section>

        <section>
          <span className="eyebrow">WATCH / AVOID</span>
          {flags.length ? flags.map((flag) => (
            <div className="hs-agent-warning" key={flag}><AlertTriangle size={14} /><span>{humanize(flag)}</span></div>
          )) : <div className="hs-result-empty">No extra contextual flags.</div>}
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

  async function buildPlan() {
    if (!ready || busyStage) return;
    setLocalError(null);
    setSnapshot(null);
    setAgentPlan(null);
    try {
      setBusyStage("Scanning full site area with FortyGuard…");
      const nextSnapshot = await createSiteSnapshot(site, crew);
      setSnapshot(nextSnapshot);
      setBusyStage("Running worker-specific bounded agent decisions…");
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
        <span>WORKER PLANS</span>
        <h1>One operational heat plan for every active worker</h1>
        <p>This screen is output-only. Site and worker details are configured separately, then FortyGuard evidence and the bounded agent build the plan here.</p>
      </header>

      {localError ? (
        <div className="hs-plan-local-error"><AlertTriangle size={16} /><span>{localError}</span><button type="button" onClick={() => setLocalError(null)}>×</button></div>
      ) : null}

      <section className="hs-advanced-card hs-plan-input-summary">
        <div className="hs-advanced-card-heading">
          <div><span>PLAN INPUTS</span><h2>{site?.name || "No worksite selected"}</h2><p>{crew.length ? `${crew.length} active worker${crew.length === 1 ? "" : "s"} configured` : "No active workers configured"}</p></div>
          <div className="hs-plan-edit-actions">
            <button type="button" onClick={() => onNavigate("site-setup")}><MapPin size={15} /> Edit site</button>
            <button type="button" onClick={() => onNavigate("crew-setup")}><Users size={15} /> Edit crew</button>
          </div>
        </div>

        <div className="hs-plan-input-grid">
          <article className={siteReady ? "ready" : ""}><MapPin size={20} /><div><strong>{siteReady ? "Site area ready" : "Site setup needed"}</strong><span>{siteReady ? `${site.polygon.length} boundary points` : "Draw the full site polygon"}</span></div></article>
          <article className={crewReady ? "ready" : ""}><Users size={20} /><div><strong>{crewReady ? `${crew.length} workers ready` : "Crew setup needed"}</strong><span>Exact location + shift + job for each worker</span></div></article>
          <article className={crew.some((worker) => worker.reassignAllowed) ? "ready" : ""}><Clock3 size={20} /><div><strong>{crew.filter((worker) => worker.reassignAllowed).length} flexible worker{crew.filter((worker) => worker.reassignAllowed).length === 1 ? "" : "s"}</strong><span>Eligible for task/time optimization</span></div></article>
        </div>
      </section>

      {!ready ? (
        <section className="hs-plan-empty-gate">
          <ShieldCheck size={30} />
          <strong>Finish setup before generating the plan</strong>
          <p>HeatShield will not invent worker positions or job details. Configure the site boundary and every active worker first.</p>
          <div><button type="button" onClick={() => onNavigate("site-setup")}><Edit3 size={15} /> Set up site</button><button type="button" onClick={() => onNavigate("crew-setup")}><Users size={15} /> Set up crew</button></div>
        </section>
      ) : (
        <button className="hs-advanced-build-button" type="button" disabled={Boolean(busyStage)} onClick={buildPlan}>
          <span className="icon"><Sparkles size={22} /></span>
          <span><strong>{busyStage || "GENERATE ALL WORKER PLANS"}</strong><small>FortyGuard site polygon + worker evidence + forecast/shift optimizer + bounded DeepSeek actions</small></span>
          <ArrowRight size={21} />
        </button>
      )}

      {snapshot ? (
        <section className="hs-plan-results">
          <div className="hs-plan-results-title">
            <span>PROVIDER + AGENT PLAN</span>
            <h2>Site intelligence is ready</h2>
            <p>FortyGuard scanned the site and worker points first. The bounded agent then received worker-specific evidence and allowed planning tools.</p>
          </div>

          <div className="hs-provider-usage-grid">
            <article><strong>{snapshot.summary?.worker_count ?? crew.length}</strong><span>workers assessed</span></article>
            <article><strong>{snapshot.provider_usage?.site_heatmap_requests ?? 0}</strong><span>site heatmap request{snapshot.provider_usage?.site_heatmap_requests === 1 ? "" : "s"}</span></article>
            <article><strong>{snapshot.provider_usage?.worker_environment_fetches ?? 0}</strong><span>worker env fetches</span></article>
            <article><strong>{snapshot.spatial_heat?.summary?.valid_tile_count ?? 0}</strong><span>mapped heat tiles</span></article>
          </div>

          <div className="hs-site-evidence-line">
            <ShieldCheck size={15} />
            <span>Site heatmap {snapshot.site_heatmap_activity_id ? "verified" : "fallback"} · {snapshot.site_heatmap_granularity ? `${snapshot.site_heatmap_granularity} m grid` : "point evidence"} · forecast {humanize(snapshot.summary?.forecast_status || "unknown")}</span>
          </div>

          {agentPlan?.results?.length ? (
            <div className="hs-worker-plan-results">
              {agentPlan.results.map((result) => <AgentWorkerResult key={result.worker_id} result={result} snapshot={snapshot} crew={crew} />)}
            </div>
          ) : <div className="hs-result-empty large">The site scan is ready; worker agent plans are still being prepared.</div>}
        </section>
      ) : null}
    </div>
  );
}
