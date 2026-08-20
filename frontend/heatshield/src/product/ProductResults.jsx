import { useState } from "react";
import {
  AlertTriangle, BrainCircuit, CheckCircle2, CircleDot, Droplets, Gauge,
  LoaderCircle, MapPinned, RefreshCw, ShieldCheck, SunMedium, ThermometerSun,
  TimerReset, UserCheck,
} from "lucide-react";
import { approveCycleActions, verifyCycle } from "../api/agenticApi.js";
import { ACTION_COPY, BAND_LABEL, actionWhy, finite, formatWhen, humanize, metric } from "./productUtils.js";

function HeatSummary({ cycle }) {
  const assessment = cycle?.current_assessment;
  const env = assessment?.environmental_evidence;
  const screening = assessment?.screening;
  const cooler = cycle?.spatial_heat?.candidates?.[0];
  const available = (cycle?.heat_outlook?.points ?? []).filter((point) => point.status === "available" && finite(point.temperature_c) !== null);
  const coolest = available.length ? [...available].sort((a, b) => a.temperature_c - b.temperature_c)[0] : null;
  if (!cycle) return null;
  return (
    <section className="product-heat-summary">
      <article className="product-risk-card">
        <span>Current heat screening</span>
        <strong>{BAND_LABEL[screening?.band] ?? "Unavailable"}</strong>
        <small>{assessment?.data_quality === "good" ? "Provider-backed current evidence" : `${humanize(assessment?.data_quality)} evidence`}</small>
      </article>
      <article><ThermometerSun size={20} /><div><span>Temperature</span><strong>{metric(env?.temperature_c)}°C</strong></div></article>
      <article><SunMedium size={20} /><div><span>Heat Index</span><strong>{metric(env?.heat_index_c)}°C</strong></div></article>
      <article><Droplets size={20} /><div><span>Humidity</span><strong>{metric(env?.relative_humidity)}%</strong></div></article>
      <article className="product-opportunity"><MapPinned size={20} /><div><span>Nearby option</span><strong>{cooler ? `${metric(cooler.cooler_by_c)}°C cooler` : "No cooler tile"}</strong><small>{cooler ? `${Math.round(cooler.straight_line_distance_m)} m away` : "Comparative provider map"}</small></div></article>
      <article className="product-opportunity"><TimerReset size={20} /><div><span>Cooler sampled time</span><strong>{coolest ? `${metric(coolest.temperature_c)}°C` : "Unavailable"}</strong><small>{coolest ? formatWhen(coolest.requested_local_timestamp) : "No interpolation"}</small></div></article>
    </section>
  );
}

function AgentPlan({ cycle, selected, setSelected }) {
  const decision = cycle?.agent_decision;
  const actions = decision?.actions ?? [];
  const reasoning = decision?.reasoning_summary;
  if (!cycle) return null;
  return (
    <section className="product-plan" id="agent-plan">
      <div className="product-plan-heading">
        <div><span className="product-eyebrow">AGENT PLAN</span><h2>What the agent recommends — and why</h2><p>{reasoning?.thermal_interpretation ?? "HeatShield built a plan from the available provider evidence."}</p></div>
        <div className="product-plan-badge"><BrainCircuit size={18} /><span>{humanize(reasoning?.urgency)} urgency</span></div>
      </div>

      <div className="product-agent-saw">
        <div><CircleDot size={16} /><span>Agent saw</span><strong>{BAND_LABEL[cycle.current_assessment?.screening?.band] ?? "Current evidence"}</strong></div>
        <div><CircleDot size={16} /><span>Task context</span><strong>{humanize(cycle.current_assessment?.task_context?.workload_level)} · {cycle.current_assessment?.task_context?.direct_sun ? "direct sun" : "no direct sun"}</strong></div>
        <div><CircleDot size={16} /><span>Decision</span><strong>{actions.length ? `${actions.length} action${actions.length === 1 ? "" : "s"} proposed` : "No action selected"}</strong></div>
      </div>

      <div className="product-action-list">
        {actions.length ? actions.map((action, index) => {
          const copy = ACTION_COPY[action.action_type] ?? { title: humanize(action.action_type), how: "Follow the approved operational control and verify fresh conditions." };
          const checked = selected.includes(action.action_id);
          return (
            <article className={`product-action-card ${checked ? "selected" : ""}`} key={action.action_id}>
              <button type="button" className="product-action-select" onClick={() => setSelected((current) => checked ? current.filter((id) => id !== action.action_id) : [...current, action.action_id])}>
                <span>{checked ? <CheckCircle2 size={18} /> : index + 1}</span>
                <div><strong>{copy.title}</strong><small>{checked ? "Selected for supervisor approval" : "Click to include in the plan"}</small></div>
              </button>
              <div className="product-action-explain">
                <div><span>WHY</span><p>{actionWhy(action, cycle)}</p></div>
                <div><span>HOW</span><p>{copy.how}</p></div>
              </div>
              {action.action_type === "consider_cooler_zone" ? (
                <div className="product-action-evidence"><MapPinned size={15} /><strong>{metric(action.details?.temperature_c)}°C candidate</strong><span>{metric(action.details?.cooler_by_c)}°C cooler · {Math.round(action.details?.straight_line_distance_m ?? 0)} m</span></div>
              ) : null}
              {action.action_type === "consider_cooler_sampled_period" ? (
                <div className="product-action-evidence"><TimerReset size={15} /><strong>{metric(action.details?.temperature_c)}°C sample</strong><span>{formatWhen(action.details?.requested_local_timestamp)}</span></div>
              ) : null}
            </article>
          );
        }) : <div className="product-empty-plan"><ShieldCheck size={28} /><strong>No operational action was selected</strong><span>Review the current evidence and refresh when conditions change.</span></div>}
      </div>
    </section>
  );
}

function ApprovalVerify({ cycle, selected, approval, setApproval, verification, setVerification, onRecheck }) {
  const [supervisor, setSupervisor] = useState("SUPERVISOR-01");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!cycle) return null;

  async function approve() {
    setBusy("approve"); setError(null);
    try { setApproval(await approveCycleActions(cycle.cycle_id, selected, supervisor)); }
    catch (operationError) { setError(operationError?.message ?? "Approval failed."); }
    finally { setBusy(null); }
  }

  async function verify() {
    setBusy("verify"); setError(null);
    try { setVerification(await verifyCycle(cycle.cycle_id)); }
    catch (operationError) { setError(operationError?.message ?? "Verification failed."); }
    finally { setBusy(null); }
  }

  async function refresh() {
    setBusy("recheck"); setError(null);
    try { await onRecheck(); }
    catch (operationError) { setError(operationError?.message ?? "Refresh failed."); }
    finally { setBusy(null); }
  }

  return (
    <section className="product-verify" id="verify">
      <div className="product-section-title"><div><span className="product-eyebrow">SUPERVISOR CONTROL</span><h2>Approve the plan, then verify fresh conditions</h2><p>The AI proposes. A supervisor authorizes. HeatShield records the action and verifies with fresh provider evidence.</p></div><ShieldCheck size={23} /></div>
      <div className="product-verify-grid">
        <article>
          <span className="product-step-number">1</span>
          <div><strong>Approve selected actions</strong><p>{selected.length} action{selected.length === 1 ? "" : "s"} selected.</p></div>
          <input value={supervisor} onChange={(event) => setSupervisor(event.target.value)} aria-label="Supervisor ID" />
          <button type="button" className="product-primary" onClick={approve} disabled={busy || approval || !selected.length}>{busy === "approve" ? <LoaderCircle className="spinner" size={16} /> : <UserCheck size={16} />}{approval ? "Approved & recorded" : "Approve & record controls"}</button>
        </article>
        <article>
          <span className="product-step-number">2</span>
          <div><strong>Verify fresh evidence</strong><p>Check the action state and obtain a fresh provider observation.</p></div>
          <button type="button" onClick={verify} disabled={busy || !approval}>{busy === "verify" ? <LoaderCircle className="spinner" size={16} /> : <Gauge size={16} />}Verify now</button>
          {verification ? <div className="product-verification-result"><CheckCircle2 size={17} /><div><strong>{humanize(verification.status)}</strong><span>{verification.verified_action_count}/{verification.executed_action_count} actions verified · ΔT {metric(verification.observed_temperature_change_c)}°C</span></div></div> : null}
        </article>
        <article>
          <span className="product-step-number">3</span>
          <div><strong>Refresh the decision</strong><p>Create a new cycle using fresh heat evidence for the same work plan.</p></div>
          <button type="button" onClick={refresh} disabled={busy}>{busy === "recheck" ? <LoaderCircle className="spinner" size={16} /> : <RefreshCw size={16} />}Refresh heat & plan</button>
        </article>
      </div>
      {error ? <div className="product-error"><AlertTriangle size={16} />{error}</div> : null}
      {verification ? <p className="product-causality">{verification.causality_disclaimer}</p> : null}
    </section>
  );
}

export { HeatSummary, AgentPlan, ApprovalVerify };
