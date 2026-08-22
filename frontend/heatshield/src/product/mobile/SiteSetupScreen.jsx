import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Layers3,
  MapPin,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import PlanMapEditor from "./PlanMapEditor.jsx";
import {
  ZONE_TYPES,
  activeWorkZones,
  createZone,
  loadSelectedSiteId,
  loadSites,
  pointInPolygon,
  polygonAreaAcres,
  saveSelectedSiteId,
  saveSites,
  seedSite,
} from "./planWorkspace.js";
import "./OperationalZones.css";

const SITE_SETUP_INTENT_KEY = "heatshield.siteSetup.intent.v1";

function zoneTypeLabel(value) {
  return ZONE_TYPES.find((item) => item.value === value)?.label || value;
}

function initializeSiteSetup(location) {
  const sites = loadSites(location);
  const selectedSiteId = loadSelectedSiteId(sites);
  let intent = null;
  try {
    intent = window.sessionStorage.getItem(SITE_SETUP_INTENT_KEY);
  } catch {
    intent = null;
  }
  return { sites, selectedSiteId, mapMode: intent === "add" ? "draw" : "idle" };
}

export default function SiteSetupScreen({ location, onNavigate }) {
  const [initialSetup] = useState(() => initializeSiteSetup(location));
  const [sites, setSites] = useState(initialSetup.sites);
  const [selectedSiteId, setSelectedSiteId] = useState(initialSetup.selectedSiteId);
  const [mapMode, setMapMode] = useState(initialSetup.mapMode);
  const [activeZoneId, setActiveZoneId] = useState(null);
  const [newZoneType, setNewZoneType] = useState("work");
  const [localError, setLocalError] = useState(null);

  useEffect(() => {
    try {
      window.sessionStorage.removeItem(SITE_SETUP_INTENT_KEY);
    } catch {
      // Navigation intent is optional; setup remains fully usable without storage.
    }
  }, []);

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? sites[0] ?? null;
  const activeZone = selectedSite?.zones?.find((zone) => zone.id === activeZoneId) || null;
  const areaAcres = polygonAreaAcres(selectedSite?.polygon ?? []);
  const masterReady = Boolean(selectedSite?.polygon?.length >= 3);
  const workZones = activeWorkZones(selectedSite);
  const activeZones = (selectedSite?.zones || []).filter((zone) => zone.active);
  const zonesInsideMaster = activeZones.every((zone) => (
    zone.polygon?.length >= 3
    && zone.polygon.every((point) => pointInPolygon(point, selectedSite?.polygon || []))
  ));
  const zonesReady = Boolean(workZones.length && zonesInsideMaster);
  const ready = masterReady && zonesReady;

  function persist(nextSites, nextSelectedId = selectedSiteId) {
    setSites(nextSites);
    saveSites(nextSites);
    saveSelectedSiteId(nextSelectedId);
  }

  function updateSelectedSite(patch) {
    const nextSites = sites.map((site) => site.id === selectedSiteId ? { ...site, ...patch } : site);
    persist(nextSites);
  }

  function updateZone(zoneId, patch) {
    updateSelectedSite({
      zones: (selectedSite?.zones || []).map((zone) => zone.id === zoneId ? { ...zone, ...patch, legacyGenerated: false } : zone),
    });
  }

  function addCurrentSite() {
    const next = seedSite(location, `SITE-${Date.now()}`);
    next.name = sites.some((site) => site.name === next.name) ? `${next.name} ${sites.length + 1}` : next.name;
    const nextSites = [...sites, next];
    setSelectedSiteId(next.id);
    setActiveZoneId(null);
    setMapMode("draw");
    persist(nextSites, next.id);
  }

  function removeSelectedSite() {
    if (sites.length <= 1) return;
    const remaining = sites.filter((site) => site.id !== selectedSiteId);
    const nextSelectedId = remaining[0]?.id ?? null;
    setSelectedSiteId(nextSelectedId);
    setActiveZoneId(null);
    setMapMode("idle");
    persist(remaining, nextSelectedId);
  }

  function selectSite(siteId) {
    setSelectedSiteId(siteId);
    saveSelectedSiteId(siteId);
    setActiveZoneId(null);
    setMapMode("idle");
    setLocalError(null);
  }

  function addOperationalZone() {
    if (!masterReady) {
      setLocalError("Draw the master site boundary before creating operational zones.");
      return;
    }
    const next = createZone((selectedSite?.zones?.length || 0) + 1, newZoneType);
    updateSelectedSite({ zones: [...(selectedSite?.zones || []), next] });
    setActiveZoneId(next.id);
    setMapMode("zone");
    setLocalError(null);
  }

  function removeZone(zoneId) {
    updateSelectedSite({ zones: (selectedSite?.zones || []).filter((zone) => zone.id !== zoneId) });
    if (activeZoneId === zoneId) {
      setActiveZoneId(null);
      setMapMode("idle");
    }
  }

  function editZone(zoneId) {
    setActiveZoneId(zoneId);
    setMapMode("zone");
    setLocalError(null);
  }

  function handleMapClick(point) {
    if (!selectedSite) return;
    if (mapMode === "draw") {
      updateSelectedSite({ polygon: [...(selectedSite.polygon ?? []), point] });
      setLocalError(null);
      return;
    }
    if (mapMode !== "zone" || !activeZone) return;
    if (!pointInPolygon(point, selectedSite.polygon || [])) {
      setLocalError("Operational zone points must stay inside the master site boundary.");
      return;
    }
    updateZone(activeZone.id, { polygon: [...(activeZone.polygon || []), point] });
    setLocalError(null);
  }

  function handleVertexMove(kind, index, point, zoneId = null) {
    if (!selectedSite) return false;
    if (kind === "site") {
      const polygon = [...(selectedSite.polygon || [])];
      if (!polygon[index]) return false;
      polygon[index] = point;
      updateSelectedSite({ polygon });
      setLocalError(null);
      return true;
    }
    if (kind === "zone") {
      if (!pointInPolygon(point, selectedSite.polygon || [])) {
        setLocalError("Operational zone vertices must remain inside the master site boundary.");
        return false;
      }
      const zone = (selectedSite.zones || []).find((item) => item.id === zoneId);
      if (!zone?.polygon?.[index]) return false;
      const polygon = [...zone.polygon];
      polygon[index] = point;
      updateZone(zone.id, { polygon });
      setLocalError(null);
      return true;
    }
    return false;
  }

  function continueToCrew() {
    if (!masterReady) {
      setLocalError("Draw the full master site boundary before adding workers.");
      return;
    }
    if (!workZones.length) {
      setLocalError("Add at least one active work zone before placing workers.");
      return;
    }
    if (!zonesInsideMaster) {
      setLocalError("Every active operational zone needs at least 3 points and must stay inside the master site boundary.");
      return;
    }
    saveSelectedSiteId(selectedSite.id);
    onNavigate("crew-setup");
  }

  return (
    <div className="hs-screen hs-advanced-plan-screen">
      <header className="hs-advanced-plan-title">
        <span>STEP 1 · SITE + OPERATIONAL ZONES</span>
        <h1>Define the property once, then mark only the places where work can actually happen</h1>
        <p>The blue master boundary gives FortyGuard full-site thermal context. Work, recovery, restricted and transit zones tell HeatShield where workers may operate or be considered for alternatives.</p>
      </header>

      {localError ? (
        <div className="hs-plan-local-error"><AlertTriangle size={16} /><span>{localError}</span><button type="button" onClick={() => setLocalError(null)}>×</button></div>
      ) : null}

      <section className="hs-advanced-card hs-site-library-card">
        <div className="hs-advanced-card-heading">
          <div><span>1 · SITE LIBRARY</span><h2>Select the physical site</h2><p>One saved site can contain many operational zones.</p></div>
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
          <div><span>2 · MASTER SITE BOUNDARY</span><h2>Draw or correct the full property / site</h2><p>Click to add boundary points. While drawing is active, drag any numbered vertex to correct the real property edge.</p></div>
          <div className="hs-boundary-meta"><strong>{selectedSite?.polygon?.length ?? 0}</strong><span>vertices</span>{areaAcres !== null ? <em>{areaAcres.toFixed(areaAcres < 10 ? 1 : 0)} acres</em> : null}</div>
        </div>
        {selectedSite ? <PlanMapEditor site={selectedSite} mode={mapMode} activeZoneId={activeZoneId} onMapClick={handleMapClick} onVertexMove={handleVertexMove} /> : null}
        <div className="hs-map-editor-actions">
          <button type="button" className={mapMode === "draw" ? "active" : ""} onClick={() => { setMapMode(mapMode === "draw" ? "idle" : "draw"); setActiveZoneId(null); }}>
            <MapPin size={16} /> {mapMode === "draw" ? "Finish boundary editing" : "Draw / edit master boundary"}
          </button>
          <button type="button" disabled={!selectedSite?.polygon?.length} onClick={() => updateSelectedSite({ polygon: (selectedSite.polygon ?? []).slice(0, -1) })}><RotateCcw size={16} /> Undo point</button>
          <button type="button" disabled={!selectedSite?.polygon?.length} onClick={() => { updateSelectedSite({ polygon: [], zones: [] }); setActiveZoneId(null); setMapMode("idle"); }}><Trash2 size={16} /> Clear site</button>
        </div>
        <div className={`hs-boundary-readiness ${masterReady ? "ready" : ""}`}>
          {masterReady ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{masterReady ? "Master site geometry ready. Any zone pushed outside it will block planning until corrected." : "Add at least 3 master boundary points."}</span>
        </div>
      </section>

      <section className="hs-advanced-card hs-zone-builder-card">
        <div className="hs-advanced-card-heading">
          <div><span>3 · OPERATIONAL ZONES</span><h2>Separate work areas from the rest of the property</h2><p>Only active work zones can hold workers. Draw new points or drag existing numbered vertices while editing a zone.</p></div>
          <div className="hs-zone-count"><Layers3 size={17} /><strong>{activeZones.length}</strong><span>active</span></div>
        </div>

        <div className="hs-zone-add-row">
          <label><span>New zone type</span><select value={newZoneType} onChange={(event) => setNewZoneType(event.target.value)}>{ZONE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          <button type="button" disabled={!masterReady} onClick={addOperationalZone}><Plus size={16} /> Add zone</button>
        </div>

        {(selectedSite?.zones || []).length ? (
          <div className="hs-zone-list">
            {selectedSite.zones.map((zone) => {
              const readyZone = zone.polygon?.length >= 3 && zone.polygon.every((point) => pointInPolygon(point, selectedSite.polygon || []));
              return (
                <article key={zone.id} className={`hs-zone-row zone-${zone.type}${zone.id === activeZoneId ? " active" : ""}`}>
                  <div className="hs-zone-row-main">
                    <span className="hs-zone-type-dot" />
                    <div>
                      <input value={zone.name} aria-label={`${zone.name} name`} onChange={(event) => updateZone(zone.id, { name: event.target.value })} />
                      <small>{zoneTypeLabel(zone.type)} · {zone.polygon?.length || 0} points{zone.legacyGenerated ? " · migrated from old full-site setup" : ""}</small>
                    </div>
                  </div>
                  <div className="hs-zone-row-controls">
                    <label><input type="checkbox" checked={zone.active} onChange={(event) => updateZone(zone.id, { active: event.target.checked })} /> Active</label>
                    {["work", "recovery"].includes(zone.type) ? <label><input type="checkbox" checked={zone.relocationAllowed} onChange={(event) => updateZone(zone.id, { relocationAllowed: event.target.checked })} /> Alternative allowed</label> : null}
                    <button type="button" onClick={() => editZone(zone.id)}><MapPin size={14} /> {zone.id === activeZoneId && mapMode === "zone" ? "Editing…" : "Draw / edit"}</button>
                    <button type="button" disabled={!zone.polygon?.length} onClick={() => updateZone(zone.id, { polygon: (zone.polygon || []).slice(0, -1) })}><RotateCcw size={14} /></button>
                    <button type="button" onClick={() => removeZone(zone.id)}><Trash2 size={14} /></button>
                  </div>
                  <div className={`hs-zone-status ${readyZone ? "ready" : ""}`}>{readyZone ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}<span>{readyZone ? "Zone geometry ready" : "Draw at least 3 points inside the master site"}</span></div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="hs-zone-empty"><ShieldAlert size={28} /><strong>No operational zones yet</strong><p>Add the real places where crews work. Roads, parking, buildings or unrelated property do not need to become work zones.</p></div>
        )}

        <div className="hs-zone-legend">
          <span><i className="work" /> Work</span><span><i className="recovery" /> Recovery</span><span><i className="restricted" /> Restricted</span><span><i className="transit" /> Transit / other</span>
        </div>
        <div className={`hs-boundary-readiness ${zonesReady ? "ready" : ""}`}>
          {zonesReady ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{zonesReady ? `${workZones.length} active work zone${workZones.length === 1 ? "" : "s"} ready for worker placement.` : "At least one complete active work zone is required."}</span>
        </div>
      </section>

      <button className="hs-advanced-build-button" type="button" disabled={!ready} onClick={continueToCrew}>
        <span className="icon"><CheckCircle2 size={22} /></span>
        <span><strong>CONTINUE TO WORKERS</strong><small>Assign each person to a real work zone and place the exact worker point</small></span>
        <ArrowRight size={21} />
      </button>
    </div>
  );
}
