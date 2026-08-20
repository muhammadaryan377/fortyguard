import {
  ArrowRight,
  CheckCircle2,
  HardHat,
  ShieldCheck,
  SunMedium,
  ThermometerSun,
  UserCheck,
  Users,
} from "lucide-react";
import { ACTION_COPY, BAND_LABEL, humanize } from "../productUtils.js";

export default function TeamScreen({ cycle, work, setWork, onNavigate }) {
  const screening = cycle?.current_assessment?.screening;
  const actions = cycle?.agent_decision?.actions ?? [];
  const workerAction = actions[0];
  const recommended = workerAction ? (ACTION_COPY[workerAction.action_type]?.title || humanize(workerAction.action_type)) : null;
  const set = (key, value) => setWork((current) => ({ ...current, [key]: value }));

  const attention = [
    !work.acclimatized ? "Not acclimatized" : null,
    ["heavy", "very_heavy"].includes(work.workload) ? "High workload" : null,
    work.directSun ? "Direct sun" : null,
  ].filter(Boolean);

  return (
    <div className="hs-screen hs-team-screen">
      <div className="hs-screen-title">
        <div><span>Worker safety</span><h1>Keep the current worker plan easy to understand</h1><p>This screen reflects the worker and task actually sent to the HeatShield cycle. No fake roster data is shown.</p></div>
      </div>

      <section className="hs-team-summary">
        <article><Users size={20} /><strong>1</strong><span>Worker in current plan</span></article>
        <article><UserCheck size={20} /><strong>{work.acclimatized ? "Yes" : "No"}</strong><span>Acclimatized</span></article>
        <article><HardHat size={20} /><strong>{humanize(work.workload)}</strong><span>Workload</span></article>
      </section>

      <section className="hs-worker-card">
        <div className="hs-worker-avatar"><HardHat size={30} /></div>
        <div className="hs-worker-main">
          <span>Current worker</span>
          <h2>{work.workerId || "WORKER-01"}</h2>
          <p>{work.taskName} · {work.duration} min · {humanize(work.ppe)} PPE</p>
          <div className="hs-worker-tags">
            {attention.length ? attention.map((item) => <span key={item}>{item}</span>) : <span className="good"><CheckCircle2 size={13} /> No extra work-factor flags</span>}
          </div>
        </div>
        <div className="hs-worker-risk"><ThermometerSun size={18} /><span>{cycle ? BAND_LABEL[screening?.band] ?? "Current heat" : "Heat not checked"}</span></div>
      </section>

      <section className="hs-readiness-card">
        <div className="hs-section-heading"><span>Heat readiness</span><h2>Update the worker context before the next plan</h2></div>
        <label><span>Worker ID</span><input value={work.workerId} onChange={(event) => set("workerId", event.target.value)} /></label>
        <div className="hs-readiness-toggles">
          <button type="button" className={work.acclimatized ? "active" : ""} onClick={() => set("acclimatized", !work.acclimatized)}><UserCheck size={18} /><span>Acclimatized</span><strong>{work.acclimatized ? "Yes" : "No"}</strong></button>
          <button type="button" className={work.directSun ? "active" : ""} onClick={() => set("directSun", !work.directSun)}><SunMedium size={18} /><span>Direct sun</span><strong>{work.directSun ? "Yes" : "No"}</strong></button>
        </div>
      </section>

      <section className="hs-worker-guidance">
        <span className="hs-feature-icon"><ShieldCheck size={21} /></span>
        <div><strong>{recommended || "Run a heat check for worker-specific guidance"}</strong><p>{workerAction ? "This recommendation comes from the current HeatShield agent decision." : "The current worker settings will be included in the next provider-backed plan."}</p></div>
        <button type="button" onClick={() => onNavigate("plan")}>Review plan <ArrowRight size={15} /></button>
      </section>
    </div>
  );
}
