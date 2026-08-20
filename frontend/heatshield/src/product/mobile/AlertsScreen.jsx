import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  ThermometerSun,
  TimerReset,
} from "lucide-react";
import { BAND_LABEL, humanize, metric } from "../productUtils.js";

export default function AlertsScreen({
  cycle,
  approval,
  verification,
  operationBusy,
  onVerify,
  onRefresh,
  onNavigate,
}) {
  const env = cycle?.current_assessment?.environmental_evidence;
  const screening = cycle?.current_assessment?.screening;
  const band = BAND_LABEL[screening?.band] ?? "No current heat alert";
  const approvalResults = approval?.results ?? [];

  if (!cycle) {
    return (
      <div className="hs-screen hs-alerts-screen">
        <div className="hs-screen-title"><div><span>Alerts & verification</span><h1>No current heat check yet</h1><p>HeatShield will show the active heat state, approved controls and fresh verification here after a plan is created.</p></div></div>
        <div className="hs-empty-state large"><TimerReset size={30} /><strong>Nothing needs verification yet</strong><span>Build a heat plan first.</span><button type="button" onClick={() => onNavigate("plan")}>Build plan <ArrowRight size={15} /></button></div>
      </div>
    );
  }

  return (
    <div className="hs-screen hs-alerts-screen">
      <div className="hs-screen-title"><div><span>Alerts & verification</span><h1>Keep the plan current as heat changes</h1><p>HeatShield separates operational records from fresh environmental evidence.</p></div></div>

      <section className="hs-alert-hero">
        <span className="hs-alert-icon"><AlertTriangle size={28} /></span>
        <div><span>Current heat screening</span><h2>{band}</h2><p>{metric(env?.temperature_c)}°C · Heat Index {metric(env?.heat_index_c)}°C</p></div>
        <span className="hs-alert-source">FortyGuard</span>
      </section>

      <section className="hs-recent-actions">
        <div className="hs-section-heading"><span>Recent actions</span><h2>What has been recorded</h2></div>
        {!approval ? (
          <div className="hs-inline-empty"><ShieldCheck size={18} /><span>No controls have been approved for this cycle yet.</span><button type="button" onClick={() => onNavigate("plan")}>Review plan</button></div>
        ) : approvalResults.map((result) => (
          <article key={result.action_id}>
            <span className="hs-status-icon"><CheckCircle2 size={19} /></span>
            <div><small>Operational record</small><strong>{humanize(result.action_type)}</strong><p>{result.safe_reason}</p></div>
            <span className="hs-status-chip">{humanize(result.status)}</span>
          </article>
        ))}
      </section>

      <section className="hs-verify-card">
        <div className="hs-section-heading"><span>Fresh evidence</span><h2>{verification ? "Verification result" : "Verify the recorded plan"}</h2></div>
        {verification ? (
          <div className="hs-before-after">
            <div><span>Before</span><strong>{metric(verification.before?.temperature_c)}°C</strong></div>
            <ArrowRight size={22} />
            <div><span>Fresh observation</span><strong>{metric(verification.after?.temperature_c)}°C</strong></div>
          </div>
        ) : <p className="hs-verify-copy">Verification requests fresh provider evidence and checks action state. It does not prove the action caused a temperature change.</p>}
        {verification ? <p className="hs-verify-copy">{verification.causality_disclaimer}</p> : null}
        <button type="button" onClick={onVerify} disabled={operationBusy || !approval}>
          {operationBusy === "verify" ? <LoaderCircle className="spinner" size={17} /> : <ThermometerSun size={17} />}
          {verification ? "Verify again" : "Verify now"}
        </button>
      </section>

      <section className="hs-refresh-card">
        <span className="hs-feature-icon"><RefreshCw size={20} /></span>
        <div><strong>Conditions changed?</strong><p>Create a successor cycle using fresh heat evidence for the same work plan.</p></div>
        <button type="button" onClick={onRefresh} disabled={operationBusy}>{operationBusy === "recheck" ? <LoaderCircle className="spinner" size={16} /> : "Refresh heat & plan"}</button>
      </section>
    </div>
  );
}
