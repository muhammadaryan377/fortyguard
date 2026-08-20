import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  ShieldCheck,
  SunMedium,
  TimerReset,
  UserCheck,
  Zap,
} from "lucide-react";
import { ACTION_COPY, actionWhy, finite, formatWhen, humanize, metric } from "../productUtils.js";

function WorkControls({ work, setWork }) {
  const set = (key, value) => setWork((current) => ({ ...current, [key]: value }));
  return (
    <section className="hs-work-card">
      <div className="hs-section-heading"><span>Work conditions</span><h2>Tell HeatShield what the worker is doing</h2></div>
      <div className="hs-work-form">
        <label className="wide"><span>Task</span><input value={work.taskName} onChange={(event) => set("taskName", event.target.value)} /></label>
        <label><span>Workload</span><select value={work.workload} onChange={(event) => set("workload", event.target.value)}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label>
        <label><span>Exposure</span><select value={work.duration} onChange={(event) => set("duration", Number(event.target.value))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option><option value={120}>120 min</option></select></label>
        <label><span>PPE</span><select value={work.ppe} onChange={(event) => set("ppe", event.target.value)}><option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option></select></label>
        <button type="button" className={work.directSun ? "hs-choice active" : "hs-choice"} onClick={() => set("directSun", !work.directSun)}><SunMedium size={17} /><span>Direct sun</span><strong>{work.directSun ? "Yes" : "No"}</strong></button>
        <button type="button" className={work.acclimatized ? "hs-choice active" : "hs-choice"} onClick={() => set("acclimatized", !work.acclimatized)}><UserCheck size={17} /><span>Acclimatized</span><strong>{work.acclimatized ? "Yes" : "No"}</strong></button>
      </div>
    </section>
  );
}

function ForecastStrip({ cycle }) {
  const points = cycle?.heat_outlook?.points ?? [];
  if (!points.length) return null;
  return (
    <section className="hs-forecast-card">
      <div className="hs-section-heading compact"><span>FortyGuard samples</span><h2>Near-term heat timing</h2></div>
      <div className="hs-forecast-strip">
        {points.map((point) => (
          <article key={point.offset_hours} className={point.status === "available" ? "" : "muted"}>
            <Clock3 size={17} />
            <span>+{point.offset_hours}h</span>
            <strong>{point.status === "available" && finite(point.temperature_c) !== null ? `${metric(point.temperature_c)}°C` : "Unavailable"}</strong>
            <small>{formatWhen(point.requested_local_timestamp)}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ActionList({ cycle, selected, setSelected }) {
  const actions = cycle?.agent_decision?.actions ?? [];
  if (!actions.length) return <div className="hs-empty-state"><ShieldCheck size={28} /><strong>No operational action was selected</strong><span>Refresh when work or heat conditions change.</span></div>;
  return (
    <div className="hs-plan-actions">
      {actions.map((action, index) => {
        const copy = ACTION_COPY[action.action_type] ?? { title: humanize(action.action_type), how: "Follow the approved operational control and recheck conditions." };
        const checked = selected.includes(action.action_id);
        return (
          <article key={action.action_id} className={checked ? "hs-action-card selected" : "hs-action-card"}>
            <button type="button" className="hs-action-main" onClick={() => setSelected((current) => checked ? current.filter((id) => id !== action.action_id) : [...current, action.action_id])}>
              <span className="hs-action-number">{checked ? <CheckCircle2 size={18} /> : index + 1}</span>
              <div><small>WHAT</small><strong>{copy.title}</strong><p>{actionWhy(action, cycle)}</p></div>
              <span className="hs-action-chip">{checked ? "Selected" : "Tap to select"}</span>
            </button>
            <div className="hs-action-how"><span>HOW</span><p>{copy.how}</p></div>
          </article>
        );
      })}
    </div>
  );
}

export default function PlanScreen({
  cycle,
  work,
  setWork,
  selected,
  setSelected,
  supervisor,
  setSupervisor,
  approval,
  analysisBusy,
  operationBusy,
  onAnalyze,
  onApprove,
  onNavigate,
}) {
  const recordedCount = (approval?.results ?? []).filter((item) =>
    ["executed", "already_executed"].includes(item.status),
  ).length;

  return (
    <div className="hs-screen hs-plan-screen">
      <div className="hs-screen-title">
        <div><span>Safer work plan</span><h1>Turn current heat into a simple operational decision</h1><p>Adjust the job, build the provider-backed plan, then approve only the controls you want recorded.</p></div>
      </div>

      <WorkControls work={work} setWork={setWork} />

      {!cycle ? (
        <button className="hs-primary-cta" type="button" onClick={onAnalyze} disabled={analysisBusy}>
          {analysisBusy ? <LoaderCircle className="spinner" size={19} /> : <Zap size={19} />}
          <span><strong>{analysisBusy ? "Building today’s plan…" : "Build plan from current heat"}</strong><small>FortyGuard current heat, spatial comparison and +1h/+3h samples</small></span>
          <ArrowRight size={18} />
        </button>
      ) : (
        <>
          <ForecastStrip cycle={cycle} />
          <section className="hs-plan-section">
            <div className="hs-section-heading"><span>Recommended controls</span><h2>What to change — and why</h2><p>{cycle.agent_decision?.reasoning_summary?.thermal_interpretation}</p></div>
            <ActionList cycle={cycle} selected={selected} setSelected={setSelected} />
          </section>

          <section className="hs-approval-card">
            <div><span>Supervisor approval</span><strong>{selected.length} control{selected.length === 1 ? "" : "s"} selected</strong><p>Approval records operational controls; it does not claim physical actuation.</p></div>
            <label><span>Supervisor ID</span><input value={supervisor} onChange={(event) => setSupervisor(event.target.value)} /></label>
            <button type="button" onClick={onApprove} disabled={operationBusy || approval || !selected.length}>
              {operationBusy === "approve" ? <LoaderCircle className="spinner" size={17} /> : <ShieldCheck size={17} />}
              {approval ? (recordedCount ? `${recordedCount} control${recordedCount === 1 ? "" : "s"} recorded` : "No controls recorded") : "Approve selected controls"}
            </button>
            {approval ? <button className="hs-link-button" type="button" onClick={() => onNavigate("alerts")}><TimerReset size={16} /> Go to verification <ArrowRight size={15} /></button> : null}
          </section>
        </>
      )}
    </div>
  );
}
