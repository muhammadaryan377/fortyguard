import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Gauge,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  XCircle,
  Zap,
} from "lucide-react";
import {
  approveCycleActions,
  fetchCycleAudit,
  recheckCycle,
  verifyCycle,
} from "../../api/agenticApi.js";
import "./AgentMissionControl.css";

const ACTION_LABELS = {
  cool_recovery: "Activate cool recovery control",
  reduce_physical_demands: "Reduce physical workload",
  consider_cooler_sampled_period: "Use cooler sampled-period candidate",
  increase_monitoring: "Increase worker monitoring",
  limit_direct_sun: "Limit direct sun exposure",
  supervisor_review: "Request supervisor review",
  consider_cooler_zone: "Use cooler-zone candidate",
  consider_shift_plan: "Apply sampled-temperature shift candidate",
};

const STAGES = ["SENSE", "ASSESS", "PREDICT", "DECIDE", "APPROVE", "ACT", "VERIFY", "RECHECK"];

function humanize(value) {
  if (!value) return "Unavailable";
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function evidenceValue(value) {
  if (value === null || value === undefined) return "--";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(evidenceValue).join(", ");
  if (typeof value === "object") {
    return Object.entries(value).slice(0, 3).map(([key, item]) => `${humanize(key)}: ${evidenceValue(item)}`).join(" · ");
  }
  return String(value);
}

function StageRail({ cycle, approval, verification, audit }) {
  const rechecked = audit.some((item) => item.event_type === "recheck_created");
  const acted = approval?.results?.some((item) => ["executed", "already_executed"].includes(item.status));
  return (
    <div className="mission-stage-rail">
      {STAGES.map((stage, index) => {
        let state = "waiting";
        if (cycle && index <= 3) state = "complete";
        if (stage === "APPROVE" && cycle?.next_step === "human_approval_required") state = approval ? "complete" : "active";
        if (stage === "ACT" && acted) state = "complete";
        if (stage === "VERIFY" && verification) state = verification.status === "insufficient_data" ? "blocked" : "complete";
        if (stage === "RECHECK" && rechecked) state = "complete";
        return (
          <div className={`mission-stage stage-${state}`} key={stage}>
            <span className="mission-stage-icon">{state === "complete" ? <CheckCircle2 size={14} /> : state === "blocked" ? <XCircle size={14} /> : <Zap size={13} />}</span>
            <div><strong>{stage}</strong><small>{state}</small></div>
            {index < STAGES.length - 1 ? <i /> : null}
          </div>
        );
      })}
    </div>
  );
}

export default function AgentMissionControl({ cycle, onCycleUpdate }) {
  const decision = cycle?.agent_decision;
  const reasoning = decision?.reasoning_summary;
  const actions = useMemo(() => decision?.actions ?? [], [decision]);
  const eligible = decision?.eligibility_trace ?? [];
  const [selected, setSelected] = useState([]);
  const [supervisor, setSupervisor] = useState("SUP-PHX-01");
  const [approval, setApproval] = useState(null);
  const [verification, setVerification] = useState(null);
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setSelected(actions.filter((action) => action.status === "proposed").map((action) => action.action_id));
    setApproval(null);
    setVerification(null);
    setError(null);
  }, [cycle?.cycle_id, actions]);

  async function refreshAudit() {
    if (!cycle?.cycle_id) return setAudit([]);
    try {
      const result = await fetchCycleAudit(cycle.cycle_id);
      setAudit(Array.isArray(result) ? result : []);
    } catch {
      // Audit is observability only; do not block operational controls.
    }
  }

  useEffect(() => {
    refreshAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle?.cycle_id]);

  function toggle(id) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function approve() {
    if (!cycle?.cycle_id || !selected.length || !supervisor.trim()) {
      return setError("Select an action and provide supervisor authorization.");
    }
    setBusy("approve"); setError(null);
    try {
      setApproval(await approveCycleActions(cycle.cycle_id, selected, supervisor.trim()));
      await refreshAudit();
    } catch (operationError) {
      setError(operationError?.message ?? "Approval failed.");
    } finally { setBusy(null); }
  }

  async function verify() {
    if (!cycle?.cycle_id) return;
    setBusy("verify"); setError(null);
    try {
      setVerification(await verifyCycle(cycle.cycle_id));
      await refreshAudit();
    } catch (operationError) {
      setError(operationError?.message ?? "Verification failed.");
    } finally { setBusy(null); }
  }

  async function recheck() {
    if (!cycle?.cycle_id) return;
    setBusy("recheck"); setError(null);
    try {
      const successor = await recheckCycle(cycle.cycle_id);
      await refreshAudit();
      onCycleUpdate?.(successor);
    } catch (operationError) {
      setError(operationError?.message ?? "Recheck failed.");
    } finally { setBusy(null); }
  }

  async function closedLoop() {
    if (!approval) return setError("Approve and execute an action before the verified loop.");
    setBusy("loop"); setError(null);
    try {
      setVerification(await verifyCycle(cycle.cycle_id));
      const successor = await recheckCycle(cycle.cycle_id);
      await refreshAudit();
      onCycleUpdate?.(successor);
    } catch (operationError) {
      setError(operationError?.message ?? "Closed-loop verification failed.");
    } finally { setBusy(null); }
  }

  return (
    <section className="panel agent-command-panel">
      <div className="mission-header">
        <div>
          <div className="section-eyebrow">CLOSED-LOOP AGENT</div>
          <h2>Agent Mission Control</h2>
          <p>Auditable evidence rationale, deterministic tool firewall, bounded AI selection, human-gated execution, fresh verification and successor-cycle recheck.</p>
        </div>
        <div className="mission-status-cluster">
          <span className="mission-chip"><BrainCircuit size={14} />{decision?.model ?? "Agent offline"}</span>
          <span className={`mission-chip urgency-${reasoning?.urgency ?? "unknown"}`}><Gauge size={14} />{humanize(reasoning?.urgency ?? "unknown")} urgency</span>
          <span className="mission-chip"><TerminalSquare size={14} />{cycle?.cycle_id?.slice(0, 8) ?? "No cycle"}</span>
        </div>
      </div>

      <StageRail cycle={cycle} approval={approval} verification={verification} audit={audit} />

      {!cycle ? (
        <div className="mission-empty"><BrainCircuit size={34} /><strong>Agent waiting for provider evidence</strong><span>Run the closed-loop analysis above.</span></div>
      ) : (
        <div className="mission-layout">
          <div className="mission-column">
            <div className="mission-block-title"><Sparkles size={15} /><div><strong>Evidence rationale</strong><small>Structured explanation, not private chain-of-thought</small></div></div>
            <p className="mission-interpretation">{reasoning?.thermal_interpretation ?? "No reasoning summary available."}</p>
            <div className="reason-signal-grid">
              {(reasoning?.evidence_signals ?? []).slice(0, 6).map((signal) => (
                <article className="reason-signal" key={`${signal.signal}-${signal.source}`}>
                  <div><strong>{humanize(signal.signal)}</strong><span className={`confidence-chip confidence-${signal.confidence}`}>{signal.confidence}</span></div>
                  <small>{signal.source}</small>
                  <b>{evidenceValue(signal.value)}</b>
                  <p>{signal.implication}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="mission-column">
            <div className="mission-block-title"><LockKeyhole size={15} /><div><strong>Eligibility firewall</strong><small>Model sees eligible server tools only</small></div></div>
            <div className="firewall-list">
              {eligible.map((item) => (
                <div className={`firewall-row ${item.eligible ? "allowed" : "blocked"}`} key={item.tool_name}>
                  {item.eligible ? <ShieldCheck size={15} /> : <XCircle size={15} />}
                  <div><strong>{humanize(item.action_type)}</strong><small>{humanize(item.safe_reason)}</small></div>
                  <span>{item.eligible ? "VISIBLE" : "HIDDEN"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {cycle ? (
        <div className="mission-actions-section">
          <div className="mission-block-title"><ClipboardCheck size={15} /><div><strong>Proposed operational actions</strong><small>Server-validated and human-gated</small></div></div>
          <div className="mission-action-grid">
            {actions.length ? actions.map((action) => (
              <button type="button" className={`mission-action ${selected.includes(action.action_id) ? "selected" : ""}`} key={action.action_id} onClick={() => toggle(action.action_id)} disabled={Boolean(approval)}>
                <span className="mission-action-check">{selected.includes(action.action_id) ? <CheckCircle2 size={17} /> : <span />}</span>
                <div><strong>{ACTION_LABELS[action.action_type] ?? humanize(action.action_type)}</strong><small>{action.reason_codes?.map(humanize).join(" · ")}</small></div>
              </button>
            )) : <div className="mission-no-actions">No operational action was selected.</div>}
          </div>

          <div className="mission-controls">
            <label><LockKeyhole size={14} /><input value={supervisor} onChange={(event) => setSupervisor(event.target.value)} disabled={Boolean(approval)} aria-label="Supervisor ID" /></label>
            <button type="button" className="mission-primary" onClick={approve} disabled={busy || approval || !actions.length}>{busy === "approve" ? <LoaderCircle className="spinner" size={15} /> : <Play size={15} />}Approve + Execute</button>
            <button type="button" onClick={verify} disabled={busy || !approval}><Eye size={15} />Verify fresh evidence</button>
            <button type="button" onClick={recheck} disabled={busy}><RefreshCw size={15} />Recheck</button>
            <button type="button" className="mission-loop" onClick={closedLoop} disabled={busy || !approval}>{busy === "loop" ? <LoaderCircle className="spinner" size={15} /> : <Zap size={15} />}Verify + Recheck loop</button>
          </div>

          {verification ? <div className="verification-strip"><CheckCircle2 size={17} /><div><strong>{humanize(verification.status)}</strong><span>Observed ΔT {evidenceValue(verification.observed_temperature_change_c)}°C · verified {verification.verified_action_count}/{verification.executed_action_count} actions</span></div></div> : null}
          {error ? <div className="mission-error"><AlertTriangle size={16} />{error}</div> : null}
        </div>
      ) : null}

      <div className="audit-console">
        <div className="mission-block-title"><TerminalSquare size={15} /><div><strong>Safe audit stream</strong><small>Latest cycle events</small></div></div>
        <div className="audit-list">
          {audit.length ? [...audit].slice(-8).reverse().map((item) => (
            <div className="audit-row" key={item.event_id}><span>{new Date(item.timestamp).toLocaleTimeString()}</span><strong>{humanize(item.event_type)}</strong><small>{evidenceValue(item.safe_details)}</small></div>
          )) : <div className="audit-empty">Audit events appear after a cycle starts.</div>}
        </div>
      </div>
    </section>
  );
}
