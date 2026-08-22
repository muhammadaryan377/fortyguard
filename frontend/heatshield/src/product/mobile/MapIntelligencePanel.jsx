import { Activity, Image, Layers3, LoaderCircle, MapPin, RefreshCw, Satellite, X } from "lucide-react";

function targetLabel(scope, site, worker, point) {
  if (scope === "worker") return worker ? `${worker.name || worker.workerId} · ${worker.zoneLabel || "work zone"}` : "Select a worker";
  if (scope === "point") return point ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : "Click a point on the map";
  return site?.name || "Selected site";
}

function frameImage(frame, segmented) {
  return segmented ? frame?.segmented_image_data_uri : frame?.original_image_data_uri;
}

function displaySegmentValue(value) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `${value.length} items`;
  if (value && typeof value === "object") {
    const numeric = Object.entries(value).find(([, nested]) => typeof nested === "number");
    if (numeric) return `${numeric[0]}: ${displaySegmentValue(numeric[1])}`;
    return `${Object.keys(value).length} fields`;
  }
  return "--";
}

function SegmentationView({ title, frame }) {
  if (!frame) return <div className="hs-mi-empty"><Image/><strong>{title} unavailable</strong><p>FortyGuard did not return this segmentation frame for the selected target.</p></div>;
  const rows = Object.entries(frame.segments || {}).slice(0, 8);
  return <div className="hs-mi-segmentation-view">
    <div className="hs-mi-frame-meta"><strong>{title}</strong><span>{frame.image_date || frame.image_year || "Image date unavailable"}</span></div>
    <div className="hs-mi-image-grid">
      <figure>{frameImage(frame, false) ? <img src={frameImage(frame, false)} alt={`${title} original`} /> : <div className="hs-mi-image-missing">Original image unavailable</div>}<figcaption>Original</figcaption></figure>
      <figure>{frameImage(frame, true) ? <img src={frameImage(frame, true)} alt={`${title} segmented`} /> : <div className="hs-mi-image-missing">Segmented image unavailable</div>}<figcaption>FortyGuard segmentation</figcaption></figure>
    </div>
    {rows.length ? <div className="hs-mi-segment-list">{rows.map(([name, value]) => <div key={name}><span>{name.replaceAll("_", " ")}</span><strong>{displaySegmentValue(value)}</strong></div>)}</div> : <p className="hs-mi-note">The imagery is available, but no normalized segment summary was returned.</p>}
    <small className="hs-mi-activity">Activity {frame.activity_id || "--"} · provider evidence, not a standalone safety determination</small>
  </div>;
}

export default function MapIntelligencePanel({
  site,
  crew,
  selectedWorkerId,
  onSelectWorker,
  scope,
  onScopeChange,
  selectedPoint,
  heat,
  heatBusy,
  onRefreshHeat,
  premium,
  premiumBusy,
  onRunPremium,
  tab,
  onTabChange,
  onClose,
}) {
  const selectedWorker = crew.find((worker) => worker.workerId === selectedWorkerId) || null;
  const canRunPremium = scope === "site" || (scope === "worker" && selectedWorker?.position) || (scope === "point" && selectedPoint);
  return <aside className="hs-mi-panel">
    <header><div><span>FORTYGUARD PREMIUM</span><h2>Site intelligence</h2><p>Choose the evidence target, then inspect heat and segmentation without changing the operational plan.</p></div><button type="button" onClick={onClose} aria-label="Close intelligence panel"><X/></button></header>

    <section className="hs-mi-target">
      <div className="hs-mi-scope-buttons">
        <button type="button" className={scope === "site" ? "active" : ""} onClick={() => onScopeChange("site")}><Layers3/>Site</button>
        <button type="button" className={scope === "worker" ? "active" : ""} onClick={() => onScopeChange("worker")}><Activity/>Worker</button>
        <button type="button" className={scope === "point" ? "active" : ""} onClick={() => onScopeChange("point")}><MapPin/>Map point</button>
      </div>
      {scope === "worker" ? <select value={selectedWorkerId || ""} onChange={(event) => onSelectWorker(event.target.value)}><option value="">Select worker</option>{crew.filter((worker) => worker.position).map((worker) => <option key={worker.workerId} value={worker.workerId}>{worker.name || worker.workerId} · {worker.zoneLabel || "work zone"}</option>)}</select> : null}
      <div className="hs-mi-target-label"><MapPin/><span>{targetLabel(scope, site, selectedWorker, selectedPoint)}</span></div>
      {scope === "point" && !selectedPoint ? <small>Click anywhere inside the selected site to set an inspection point.</small> : null}
    </section>

    <section className="hs-mi-heat-card">
      <div><ThermalIcon/><span><strong>FortyGuard TCM heat layer</strong><small>{heat ? `${heat.featureCount} cells · ${heat.cacheHit ? "session cache" : "provider refreshed"}` : "Load evidence for this selected site"}</small></span></div>
      <button type="button" onClick={onRefreshHeat} disabled={heatBusy}>{heatBusy ? <LoaderCircle className="spinner"/> : <RefreshCw/>}{heat ? "Refresh" : "Load heat"}</button>
      {heat?.activityId ? <em>Activity {heat.activityId}</em> : null}
    </section>

    <section className="hs-mi-premium-action">
      <div><Satellite/><span><strong>Premium imagery intelligence</strong><small>Satellite + street-view segmentation for the selected target.</small></span></div>
      <button type="button" disabled={!canRunPremium || premiumBusy} onClick={onRunPremium}>{premiumBusy ? <LoaderCircle className="spinner"/> : <Satellite/>}{premiumBusy ? "Running…" : "Run Premium"}</button>
    </section>

    <nav className="hs-mi-tabs">{[["overview","Overview"],["satellite","Satellite"],["street","Street view"]].map(([id, label]) => <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => onTabChange(id)}>{label}</button>)}</nav>

    <div className="hs-mi-content">
      {tab === "overview" ? <div className="hs-mi-overview">
        <div><span>Premium status</span><strong>{premium?.status || "Not run"}</strong></div>
        <div><span>Satellite frame</span><strong>{premium?.satellite ? "Available" : "--"}</strong></div>
        <div><span>Street-view frame</span><strong>{premium?.street_view ? "Available" : "--"}</strong></div>
        <div><span>Heat cells</span><strong>{heat?.featureCount ?? "--"}</strong></div>
        {premium?.limitations?.length ? <ul>{premium.limitations.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul> : <p>Select a target and run Premium to inspect real provider imagery evidence.</p>}
      </div> : null}
      {tab === "satellite" ? <SegmentationView title="Satellite segmentation" frame={premium?.satellite} /> : null}
      {tab === "street" ? <SegmentationView title="Street-view segmentation" frame={premium?.street_view} /> : null}
    </div>
  </aside>;
}

function ThermalIcon() {
  return <span className="hs-mi-thermal-icon">°</span>;
}
