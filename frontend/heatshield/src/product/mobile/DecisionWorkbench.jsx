import { useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Eye,
  Image as ImageIcon,
  Loader2,
  MapPin,
  ShieldCheck,
  Sparkles,
  ThermometerSun,
} from "lucide-react";

import { approveCycleActions, verifyCycle } from "../../api/agenticApi.js";
import {
  fetchBoundedSpatialIntelligence,
  fetchPremiumCandidateIntelligence,
} from "../../api/decisionIntelligenceApi.js";
import { humanize } from "../productUtils.js";
import DecisionComparisonStrip from "./DecisionComparisonStrip.jsx";
import DecisionTwinMap from "./DecisionTwinMap.jsx";
import SiteResiliencePanel from "./SiteResiliencePanel.jsx";
import { cToF, formatTimestamp, pointInPolygon, zoneById } from "./planWorkspace.js";
import "./DecisionWorkbench.css";
import "./DecisionWorkbenchV2.css";

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fahrenheit(value) {
  const result = cToF(value);
  return result === null ? "--" : `${result}°F`;
}

function deltaF(celsiusDelta) {
  const number = asFiniteNumber(celsiusDelta);
  if (number === null) return "--";
  const converted = Math.round((number * 9) / 5 * 10) / 10;
  return `${converted > 0 ? "+" : ""}${converted}°F`;
}

function topSegments(segments) {
  return Object.entries(segments || {})
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => {
      const left = asFiniteNumber(a.value);
      const right = asFiniteNumber(b.value);
      if (left !== null && right !== null) return right - left;
      return a.label.localeCompare(b.label);
    })
    .slice(0, 6);
}

function SegmentList({ title, frame }) {
  const rows = topSegments(frame?.segments);
  return (
    <div className="hs-di-segments">
      <strong>{title}</strong>
      {rows.length ? rows.map((row) => (
        <div key={row.label}><span>{humanize(row.label)}</span><b>{typeof row.value === "number" ? `${Math.round(row.value * 10) / 10}%` : String(row.value)}</b></div>
      )) : <small>No class coverage values were returned.</small>}
    </div>
  );
}

function ImageryPanel({ label, frame }) {
  if (!frame) {
    return <article className="hs-di-imagery-card empty"><ImageIcon size={20} /><strong>{label}</strong><span>Provider imagery unavailable for this request.</span></article>;
  }
  return (
    <article className="hs-di-imagery-card">
      <div className="hs-di-imagery-head">
        <div><span>{label}</span><strong>{frame.image_date || (frame.image_year ? `Imagery ${frame.image_year}` : "FortyGuard imagery")}</strong></div>
        <small>provider activity {frame.activity_id?.slice(0, 8) || "--"}</small>
      </div>
      <div className="hs-di-image-grid">
        <figure>{frame.original_image_data_uri ? <img src={frame.original_image_data_uri} alt={`${label} original provider view`} /> : <div className="hs-di-image-empty">Original image not returned</div>}<figcaption>Original provider image</figcaption></figure>
        <figure>{frame.segmented_image_data_uri ? <img src={frame.segmented_image_data_uri} alt={`${label} segmentation view`} /> : <div className="hs-di-image-empty">Segmentation image not returned</div>}<figcaption>FortyGuard segmentation</figcaption></figure>
      </div>
      <SegmentList title="Provider segmentation classes" frame={frame} />
    </article>
  );
}

function workerDisplay(result, crew) {
  return crew.find((worker) => worker.workerId === result?.worker_id) || { workerId: result?.worker_id, name: result?.worker_id };
}

function allowedSpatialZones(worker, site) {
  if (!worker?.reassignAllowed) return [];
  const ids = new Set([worker.zoneId, ...(worker.allowedZoneIds || [])].filter(Boolean));
  return [...ids]
    .map((id) => zoneById(site, id))
    .filter((zone) => zone && zone.active && zone.relocationAllowed && ["work", "recovery"].includes(zone.type));
}

function pointAllowedForWorker(point, worker, site) {
  if (!point || !pointInPolygon(point, site?.polygon || [])) return false;
  const zones = allowedSpatialZones(worker, site);
  return zones.some((zone) => pointInPolygon(point, zone.polygon || []));
}

function actionAllowed(action, site, worker) {
  if (action?.action_type !== "consider_cooler_zone") return true;
  const latitude = asFiniteNumber(action?.details?.centroid_latitude);
  const longitude = asFiniteNumber(action?.details?.centroid_longitude);
  if (latitude === null || longitude === null) return false;
  return pointAllowedForWorker({ latitude, longitude }, worker, site);
}

function candidateAllowed(candidate, site, worker) {
  const latitude = asFiniteNumber(candidate?.centroid_latitude);
  const longitude = asFiniteNumber(candidate?.centroid_longitude);
  return candidate?.inside_operational_boundary === true
    && latitude !== null
    && longitude !== null
    && pointAllowedForWorker({ latitude, longitude }, worker, site);
}

export default function DecisionWorkbench({
  agentPlan,
  crew,
  site,
  selectedWorkerId: controlledWorkerId = "",
  onSelectedWorkerChange,
  showWorkerTabs = true,
}) {
  const results = agentPlan?.results || [];
  const [internalWorkerId, setInternalWorkerId] = useState(results[0]?.worker_id || "");
  const [spatialByWorker, setSpatialByWorker] = useState({});
  const [selectedCandidateByWorker, setSelectedCandidateByWorker] = useState({});
  const [premiumByCandidate, setPremiumByCandidate] = useState({});
  const [supervisorId, setSupervisorId] = useState("");
  const [approvalByCycle, setApprovalByCycle] = useState({});
  const [verificationByCycle, setVerificationByCycle] = useState({});
  const [showResilience, setShowResilience] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState(null);

  const selectedWorkerId = controlledWorkerId || internalWorkerId || results[0]?.worker_id || "";
  const selectedResult = results.find((result) => result.worker_id === selectedWorkerId) || results[0] || null;
  const worker = workerDisplay(selectedResult, crew);
  const cycle = selectedResult?.cycle || null;
  const cycleId = cycle?.cycle_id || "";
  const currentEnvironment = cycle?.current_assessment?.environmental_evidence || {};
  const currentTemp = asFiniteNumber(currentEnvironment.temperature_c);
  const forecastPoints = (cycle?.heat_outlook?.points || []).filter((point) => point.status === "available" && asFiniteNumber(point.temperature_c) !== null);
  const bestFuture = useMemo(() => {
    if (!forecastPoints.length) return null;
    return [...forecastPoints].sort((a, b) => asFiniteNumber(a.temperature_c) - asFiniteNumber(b.temperature_c))[0];
  }, [forecastPoints]);
  const coolerFuture = bestFuture && currentTemp !== null && asFiniteNumber(bestFuture.temperature_c) < currentTemp ? bestFuture : null;
  const boundedSpatial = spatialByWorker[selectedResult?.worker_id] || cycle?.spatial_heat || null;
  const candidates = (boundedSpatial?.candidates || []).filter((candidate) => candidateAllowed(candidate, site, worker));
  const requestedCandidateId = selectedCandidateByWorker[selectedResult?.worker_id];
  const selectedCandidate = candidates.find((candidate) => candidate.candidate_id === requestedCandidateId) || candidates[0] || null;
  const actions = cycle?.agent_decision?.actions || [];
  const approvableActions = actions.filter((action) => action.status === "proposed" && actionAllowed(action, site, worker));
  const blockedSpatialActions = actions.filter((action) => action.status === "proposed" && action.action_type === "consider_cooler_zone" && !actionAllowed(action, site, worker));
  const approval = approvalByCycle[cycleId] || null;
  const verification = verificationByCycle[cycleId] || null;

  if (!selectedResult || !cycle) return null;

  function changeWorker(workerId) {
    setInternalWorkerId(workerId);
    onSelectedWorkerChange?.(workerId);
    setError(null);
  }

  function selectCandidate(candidateId) {
    setSelectedCandidateByWorker((current) => ({ ...current, [selectedResult.worker_id]: candidateId }));
  }

  async function runBoundedSpatial() {
    if (!worker?.position) {
      setError("This worker needs an exact map position before a spatial comparison can run.");
      return;
    }
    setError(null);
    setBusyKey(`spatial:${selectedResult.worker_id}`);
    try {
      const result = await fetchBoundedSpatialIntelligence(site, worker);
      setSpatialByWorker((current) => ({ ...current, [selectedResult.worker_id]: result }));
      const first = (result?.candidates || []).find((candidate) => candidateAllowed(candidate, site, worker));
      if (first) selectCandidate(first.candidate_id);
    } catch (nextError) {
      setError(nextError?.message || "The operational-zone spatial comparison failed.");
    } finally {
      setBusyKey(null);
    }
  }

  async function inspectCandidate(candidate) {
    selectCandidate(candidate.candidate_id);
    const key = `${selectedResult.worker_id}:${candidate.candidate_id}`;
    setError(null);
    setBusyKey(`premium:${key}`);
    try {
      const result = await fetchPremiumCandidateIntelligence(site, candidate, currentEnvironment.timestamp || cycle?.heat_outlook?.generated_at || null);
      setPremiumByCandidate((current) => ({ ...current, [key]: result }));
    } catch (nextError) {
      setError(nextError?.message || "Premium location imagery could not be loaded.");
    } finally {
      setBusyKey(null);
    }
  }

  async function approvePlan() {
    const supervisor = supervisorId.trim();
    if (!supervisor) {
      setError("Enter the supervisor ID before approving operational actions.");
      return;
    }
    if (!approvableActions.length) {
      setError("There are no proposed actions eligible for approval on this worker plan.");
      return;
    }
    setError(null);
    setBusyKey(`approve:${cycleId}`);
    try {
      const result = await approveCycleActions(cycleId, approvableActions.map((action) => action.action_id), supervisor);
      setApprovalByCycle((current) => ({ ...current, [cycleId]: result }));
    } catch (nextError) {
      setError(nextError?.message || "The worker plan could not be approved.");
    } finally {
      setBusyKey(null);
    }
  }

  async function verifyPlan() {
    setError(null);
    setBusyKey(`verify:${cycleId}`);
    try {
      const result = await verifyCycle(cycleId);
      setVerificationByCycle((current) => ({ ...current, [cycleId]: result }));
    } catch (nextError) {
      setError(nextError?.message || "Fresh evidence verification failed.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="hs-di-shell hs-di-shell-light">
      <div className="hs-di-title">
        <div><span>DECISION WORKBENCH</span><h2>Compare time, approved space and provider context</h2><p>Cooler means lower sampled temperature only. Spatial options are restricted to the worker’s supervisor-approved work/recovery zones.</p></div>
        <Sparkles size={25} />
      </div>

      {showWorkerTabs ? (
        <div className="hs-di-worker-tabs">
          {results.map((result) => {
            const item = workerDisplay(result, crew);
            return <button type="button" className={result.worker_id === selectedResult.worker_id ? "active" : ""} key={result.worker_id} onClick={() => changeWorker(result.worker_id)}><span>{item.name || result.worker_id}</span><small>{item.zoneLabel || result.worker_id}</small></button>;
          })}
        </div>
      ) : null}

      {error ? <div className="hs-di-error">{error}</div> : null}

      <div className="hs-di-current-strip">
        <article><ThermometerSun size={20} /><div><span>Current worker tile</span><strong>{fahrenheit(currentEnvironment.temperature_c)}</strong></div></article>
        <article><Clock3 size={20} /><div><span>Forecast samples</span><strong>{forecastPoints.length}</strong></div></article>
        <article><ShieldCheck size={20} /><div><span>Agent state</span><strong>{humanize(cycle.agent_decision?.status || "unknown")}</strong></div></article>
      </div>

      <DecisionComparisonStrip currentTemp={currentTemp} bestFuture={coolerFuture} selectedCandidate={selectedCandidate} site={site} />
      <DecisionTwinMap site={site} worker={worker} spatial={boundedSpatial} selectedCandidateId={selectedCandidate?.candidate_id || null} onSelectCandidate={selectCandidate} />

      <div className="hs-di-compare-grid">
        <article className="hs-di-panel">
          <div className="hs-di-panel-head"><div><span>WHAT IF · TIME</span><h3>When is a lower sampled period available?</h3></div><Clock3 size={20} /></div>
          <div className="hs-di-time-list">
            <div className="current"><span>Now</span><strong>{fahrenheit(currentEnvironment.temperature_c)}</strong><small>worker tile</small></div>
            {forecastPoints.map((point) => {
              const sampledTemp = asFiniteNumber(point.temperature_c);
              const difference = currentTemp === null ? null : sampledTemp - currentTemp;
              return <div key={point.offset_hours} className={coolerFuture?.offset_hours === point.offset_hours ? "best" : ""}><span>{formatTimestamp(point.requested_local_timestamp, site?.timezone)}</span><strong>{fahrenheit(point.temperature_c)}</strong><small>{currentTemp !== null ? `${deltaF(difference)} vs now` : `+${point.offset_hours}h`}</small></div>;
            })}
          </div>
          {coolerFuture ? <div className="hs-di-callout"><CheckCircle2 size={16} /><span>Lowest available sample: {fahrenheit(coolerFuture.temperature_c)} at {formatTimestamp(coolerFuture.requested_local_timestamp, site?.timezone)}. Comparative timing only.</span></div> : <div className="hs-di-muted">No strictly cooler future sample is available.</div>}
        </article>

        <article className="hs-di-panel">
          <div className="hs-di-panel-head"><div><span>WHAT IF · SPACE</span><h3>Which approved zone has a lower-temperature tile?</h3></div><MapPin size={20} /></div>
          {!boundedSpatial ? (
            <div className="hs-di-spatial-gate"><MapPin size={28} /><strong>Run an approved-zone comparison</strong><p>Only the worker’s current and explicitly allowed relocation zones are submitted as candidate geometry.</p><button type="button" onClick={runBoundedSpatial} disabled={busyKey === `spatial:${selectedResult.worker_id}`}>{busyKey === `spatial:${selectedResult.worker_id}` ? <Loader2 className="spin" size={17} /> : <Activity size={17} />}{busyKey === `spatial:${selectedResult.worker_id}` ? "SCANNING…" : "COMPARE APPROVED ZONES"}</button></div>
          ) : candidates.length ? (
            <div className="hs-di-candidates">
              {candidates.map((candidate) => {
                const key = `${selectedResult.worker_id}:${candidate.candidate_id}`;
                const premium = premiumByCandidate[key];
                const selected = candidate.candidate_id === selectedCandidate?.candidate_id;
                return (
                  <div className={`hs-di-candidate${selected ? " selected" : ""}`} key={candidate.candidate_id}>
                    <div className="hs-di-candidate-main"><span>#{candidate.rank} · APPROVED OPERATIONAL ZONE{selected ? " · SELECTED" : ""}</span><strong>{fahrenheit(candidate.temperature_c)}</strong><small>{deltaF(-candidate.cooler_by_c)} vs worker · {Math.round(candidate.straight_line_distance_m)} m straight-line</small></div>
                    <div className="hs-di-candidate-actions"><code>{Number(candidate.centroid_latitude).toFixed(5)}, {Number(candidate.centroid_longitude).toFixed(5)}</code><button className="select" type="button" onClick={() => selectCandidate(candidate.candidate_id)}><MapPin size={15} />{selected ? "SELECTED" : "COMPARE"}</button><button type="button" onClick={() => inspectCandidate(candidate)} disabled={busyKey === `premium:${key}`}>{busyKey === `premium:${key}` ? <Loader2 className="spin" size={15} /> : <Eye size={15} />}{premium ? "REFRESH CONTEXT" : "INSPECT PREMIUM CONTEXT"}</button></div>
                    {premium ? <div className="hs-di-premium-inline"><div className="hs-di-premium-status"><ImageIcon size={15} /><strong>{humanize(premium.status)}</strong><span>FortyGuard Premium context · supervisor verification still required</span></div><div className="hs-di-imagery-grid"><ImageryPanel label="Satellite" frame={premium.satellite} /><ImageryPanel label="Street view" frame={premium.street_view} /></div></div> : null}
                  </div>
                );
              })}
            </div>
          ) : <div className="hs-di-muted">No strictly cooler candidate exists inside this worker’s approved operational zones.</div>}
        </article>
      </div>

      <article className="hs-di-approval-panel">
        <div className="hs-di-panel-head"><div><span>HUMAN-GATED ACT</span><h3>Authorize bounded actions, then verify fresh evidence</h3></div><ShieldCheck size={21} /></div>
        {blockedSpatialActions.length ? <div className="hs-di-blocked"><ShieldCheck size={15} /><span>{blockedSpatialActions.length} cooler-zone action{blockedSpatialActions.length === 1 ? "" : "s"} blocked because the coordinate is outside this worker’s approved operational zones.</span></div> : null}
        <div className="hs-di-action-review">
          {actions.length ? actions.map((action) => {
            const allowed = actionAllowed(action, site, worker);
            return <div key={action.action_id} className={allowed ? "" : "blocked"}><CheckCircle2 size={15} /><span><strong>{humanize(action.action_type)}</strong><small>{allowed ? "eligible for supervisor approval" : "blocked by operational-zone guardrail"}</small></span></div>;
          }) : <small>No operational action was proposed for this worker.</small>}
        </div>
        <div className="hs-di-approval-controls">
          <label><span>Supervisor ID</span><input value={supervisorId} onChange={(event) => setSupervisorId(event.target.value)} placeholder="e.g. SUP-104" /></label>
          <button type="button" onClick={approvePlan} disabled={!approvableActions.length || Boolean(approval) || busyKey === `approve:${cycleId}`}>{busyKey === `approve:${cycleId}` ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}{approval ? "PLAN AUTHORIZED" : `APPROVE ${approvableActions.length} ACTION${approvableActions.length === 1 ? "" : "S"}`}</button>
          <button type="button" className="verify" onClick={verifyPlan} disabled={!approval || busyKey === `verify:${cycleId}`}>{busyKey === `verify:${cycleId}` ? <Loader2 className="spin" size={17} /> : <Activity size={17} />}VERIFY FRESH EVIDENCE</button>
        </div>
        {approval ? <div className="hs-di-execution-result"><strong>Operational record created</strong><span>{approval.results?.length || 0} approved action result{approval.results?.length === 1 ? "" : "s"} · supervisor {approval.supervisor_id}</span></div> : null}
        {verification ? <div className="hs-di-verification"><div><span>Before</span><strong>{fahrenheit(verification.before?.temperature_c)}</strong></div><div><span>After</span><strong>{fahrenheit(verification.after?.temperature_c)}</strong></div><div><span>Observed change</span><strong>{verification.observed_temperature_change_c === null || verification.observed_temperature_change_c === undefined ? "--" : deltaF(verification.observed_temperature_change_c)}</strong></div><p>{verification.causality_disclaimer || "Fresh evidence is observational and does not prove the approved action caused the change."}</p></div> : null}
      </article>

      <button type="button" className={`hs-resilience-toggle${showResilience ? " open" : ""}`} onClick={() => setShowResilience((value) => !value)}>
        <span><strong>SITE RESILIENCE · HISTORICAL FORTYGUARD</strong><small>{showResilience ? "Hide historical planning evidence" : "Open only when you need long-term hotspot evidence"}</small></span><ChevronDown size={19} />
      </button>
      {showResilience ? <SiteResiliencePanel site={site} /> : null}
    </section>
  );
}
