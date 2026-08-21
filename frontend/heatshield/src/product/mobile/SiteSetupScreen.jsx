import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  MapPin,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";

import PlanMapEditor from "./PlanMapEditor.jsx";
import {
  loadSelectedSiteId,
  loadSites,
  polygonAreaAcres,
  saveSelectedSiteId,
  saveSites,
  seedSite,
} from "./planWorkspace.js";

export default function SiteSetupScreen({ location, onNavigate }) {
  const initialSites = useMemo(() => loadSites(location), [location]);
  const [sites, setSites] = useState(initialSites);
  const [selectedSiteId, setSelectedSiteId] = useState(() => loadSelectedSiteId(initialSites));
  const [mapMode, setMapMode] = useState("idle");
  const [localError, setLocalError] = useState(null);

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? sites[0] ?? null;
  const areaAcres = polygonAreaAcres(selectedSite?.polygon ?? []);
  const polygonReady = Boolean(selectedSite?.polygon?.length >= 3);

  function persist(nextSites, nextSelectedId = selectedSiteId) {
    setSites(nextSites);
    saveSites(nextSites);
    saveSelectedSiteId(nextSelectedId);
  }

  function updateSelectedSite(patch) {
    const nextSites = sites.map((site) => site.id === selectedSiteId ? { ...site, ...patch } : site);
    persist(nextSites);
  }

  function addCurrentSite() {
    const next = seedSite(location, `SITE-${Date.now()}`);
    next.name = sites.some((site) => site.name === next.name) ? `${next.name} ${sites.length + 1}` : next.name;
    const nextSites = [...sites, next];
    setSelectedSiteId(next.id);
    setMapMode("draw");
    persist(nextSites, next.id);
  }

  function removeSelectedSite() {
    if (sites.length <= 1) return;
    const remaining = sites.filter((site) => site.id !== selectedSiteId);
    const nextSelectedId = remaining[0]?.id ?? null;
    setSelectedSiteId(nextSelectedId);
    setMapMode("idle");
    persist(remaining, nextSelectedId);
  }

  function selectSite(siteId) {
    setSelectedSiteId(siteId);
    saveSelectedSiteId(siteId);
    setMapMode("idle");
    setLocalError(null);
  }

  function handleMapClick(point) {
    if (mapMode !== "draw" || !selectedSite) return;
    updateSelectedSite({ polygon: [...(selectedSite.polygon ?? []), point] });
    setLocalError(null);
  }

  function continueToCrew() {
    if (!polygonReady) {
      setLocalError("Draw the full site boundary before adding workers.");
      return;
    }
    saveSelectedSiteId(selectedSite.id);
    onNavigate("crew-setup");
  }

  return (
    <div className="hs-screen hs-advanced-plan-screen">
      <header className="hs-advanced-plan-title">
        <span>SITE SETUP</span>
        <h1>Choose the site and define its full working area</h1>
        <p>HeatShield uses a polygon, not a single point, so FortyGuard can scan the operational area before worker-specific planning begins.</p>
      </header>

      {localError ? (
        <div className="hs-plan-local-error"><AlertTriangle size={16} /><span>{localError}</span><button type="button" onClick={() => setLocalError(null)}>×</button></div>
      ) : null}

      <section className="hs-advanced-card hs-site-library-card">
        <div className="hs-advanced-card-heading">
          <div><span>1 · SITE LIBRARY</span><h2>Select an existing site or add a new one</h2></div>
          <div className="hs-site-library-actions">
            <button type="button" onClick={addCurrentSite}><Plus size={15} /> Add current site</button>
            <button type="button" disabled={sites.length <= 1} onClick={removeSelectedSite}><Trash2 size={15} /></button>
          </div>
        </div>
        <div className="hs-site-selector-grid">
          <label><span>Saved site</span><select value={selectedSiteId ?? ""} onChange={(event) => selectSite(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
          <label><span>Site name</span><input value={selectedSite?.name ?? ""} onChange={(event) => updateSelectedSite({ name: event.target.value })} /></label>
        </div>
        <p className="hs-site-address"><MapPin size={14} /> {selectedSite?.address || `${selectedSite?.city}, ${selectedSite?.state}`}</p>
      </section>

      <section className="hs-advanced-card hs-site-boundary-card">
        <div className="hs-advanced-card-heading">
          <div><span>2 · FULL SITE AREA</span><h2>Draw the operational boundary</h2><p>Tap around the outside edge of the property or worksite. This polygon becomes the FortyGuard heatmap area of interest.</p></div>
          <div className="hs-boundary-meta"><strong>{selectedSite?.polygon?.length ?? 0}</strong><span>vertices</span>{areaAcres !== null ? <em>{areaAcres.toFixed(areaAcres < 10 ? 1 : 0)} acres</em> : null}</div>
        </div>
        {selectedSite ? <PlanMapEditor site={selectedSite} mode={mapMode} onMapClick={handleMapClick} /> : null}
        <div className="hs-map-editor-actions">
          <button type="button" className={mapMode === "draw" ? "active" : ""} onClick={() => setMapMode(mapMode === "draw" ? "idle" : "draw")}>
            <MapPin size={16} /> {mapMode === "draw" ? "Finish boundary" : "Draw / extend boundary"}
          </button>
          <button type="button" disabled={!selectedSite?.polygon?.length} onClick={() => updateSelectedSite({ polygon: (selectedSite.polygon ?? []).slice(0, -1) })}><RotateCcw size={16} /> Undo point</button>
          <button type="button" disabled={!selectedSite?.polygon?.length} onClick={() => updateSelectedSite({ polygon: [] })}><Trash2 size={16} /> Clear</button>
        </div>
        <div className={`hs-boundary-readiness ${polygonReady ? "ready" : ""}`}>
          {polygonReady ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{polygonReady ? "Site area ready. Next, place the active workers inside this boundary." : "Add at least 3 boundary points to continue."}</span>
        </div>
      </section>

      <button className="hs-advanced-build-button" type="button" disabled={!polygonReady} onClick={continueToCrew}>
        <span className="icon"><CheckCircle2 size={22} /></span>
        <span><strong>CONTINUE TO CREW SETUP</strong><small>Place workers, record exact tasks and capture flexible work options</small></span>
        <ArrowRight size={21} />
      </button>
    </div>
  );
}
