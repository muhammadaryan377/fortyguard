import {
  CheckCircle2, ChevronRight, CloudSun, Flame, LoaderCircle, MapPinned, Search,
  Shield, SunMedium, UserCheck, Users,
} from "lucide-react";

function Brand() {
  return (
    <div className="product-brand">
      <div className="product-brand-mark"><Shield size={35} /><Flame size={16} fill="currentColor" /></div>
      <div><strong><span>Heat</span>Shield</strong><small>Outdoor heat operations</small></div>
    </div>
  );
}

function Sidebar({ cycle, approval, verification }) {
  const steps = [
    ["01", "Heat check", Boolean(cycle)],
    ["02", "Agent plan", Boolean(cycle?.agent_decision)],
    ["03", "Supervisor action", Boolean(approval)],
    ["04", "Verify", Boolean(verification)],
  ];
  return (
    <aside className="product-sidebar">
      <Brand />
      <div className="product-sidebar-copy">
        <span>FIELD SAFETY WORKFLOW</span>
        <h3>Know the heat. Choose the control. Verify the plan.</h3>
      </div>
      <div className="product-steps">
        {steps.map(([number, label, complete], index) => (
          <div className={`product-step ${complete ? "complete" : ""}`} key={label}>
            <span>{complete ? <CheckCircle2 size={16} /> : number}</span>
            <div><strong>{label}</strong><small>{complete ? "Complete" : index === 0 ? "Start here" : "Waiting"}</small></div>
          </div>
        ))}
      </div>
      <div className="product-provider">
        <CloudSun size={20} />
        <div><small>Heat evidence</small><strong>FortyGuard</strong></div>
      </div>
      <div className="product-scope-note">Current product scope: United States worksites.</div>
    </aside>
  );
}

function SearchLocation({
  value,
  onChange,
  onSearch,
  searching,
  results,
  onChoose,
}) {
  return (
    <div className="product-location-search">
      <form onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
        <Search size={18} />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search any U.S. city, address, or coordinates"
          aria-label="Search work location"
        />
        <button type="submit" disabled={searching}>
          {searching ? <LoaderCircle className="spinner" size={16} /> : <MapPinned size={16} />}
          Find location
        </button>
      </form>
      {results.length ? (
        <div className="product-search-results">
          {results.map((item) => (
            <button type="button" key={`${item.site_id}-${item.latitude}`} onClick={() => onChoose(item)}>
              <MapPinned size={15} />
              <div><strong>{item.name}</strong><span>{item.display_name}</span></div>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkContext({ work, setWork }) {
  const set = (field, value) => setWork((current) => ({ ...current, [field]: value }));
  return (
    <section className="product-work-card">
      <div className="product-section-title">
        <div><span className="product-eyebrow">WORK CONDITIONS</span><h2>Tell the agent what the worker is doing</h2></div>
        <Users size={22} />
      </div>
      <div className="product-work-grid">
        <label className="wide"><span>Task</span><input value={work.taskName} onChange={(e) => set("taskName", e.target.value)} /></label>
        <label><span>Workload</span><select value={work.workload} onChange={(e) => set("workload", e.target.value)}><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option><option value="very_heavy">Very heavy</option></select></label>
        <label><span>Exposure</span><select value={work.duration} onChange={(e) => set("duration", Number(e.target.value))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option><option value={120}>120 min</option></select></label>
        <label><span>PPE</span><select value={work.ppe} onChange={(e) => set("ppe", e.target.value)}><option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option></select></label>
        <button type="button" className={`product-toggle ${work.directSun ? "active" : ""}`} onClick={() => set("directSun", !work.directSun)}><SunMedium size={17} /><span>Direct sun</span><strong>{work.directSun ? "Yes" : "No"}</strong></button>
        <button type="button" className={`product-toggle ${work.acclimatized ? "active" : ""}`} onClick={() => set("acclimatized", !work.acclimatized)}><UserCheck size={17} /><span>Acclimatized</span><strong>{work.acclimatized ? "Yes" : "No"}</strong></button>
      </div>
    </section>
  );
}

export { Sidebar, SearchLocation, WorkContext };
