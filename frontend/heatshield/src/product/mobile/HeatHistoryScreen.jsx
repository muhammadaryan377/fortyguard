import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, History, LoaderCircle, MapPinned, ShieldCheck, Sparkles, ThermometerSun } from "lucide-react";
import GoogleSiteMap from "../../components/map/GoogleSiteMap.jsx";
import { analyzeSiteHeatHistory } from "../../api/heatHistoryApi.js";
import {
  loadSelectedSiteId,
  loadSites,
  polygonAreaAcres,
  saveSelectedSiteId,
} from "./planWorkspace.js";
import "./HeatHistoryScreen.css";

function fFromC(value) {
  const number = Number(value);
  return Number.isFinite(number) ? (number * 9) / 5 + 32 : null;
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "--";
}

function zoneCount(site) {
  return (site?.zones || []).filter((zone) => zone?.active !== false && Array.isArray(zone?.polygon) && zone.polygon.length >= 3).length;
}

export default function HeatHistoryScreen({ location }) {
  const [sites, setSites] = useState(() => loadSites(location));
  const [selectedSiteId, setSelectedSiteId] = useState(() => loadSelectedSiteId(loadSites(location)));
  const [days, setDays] = useState(30);
  const [thresholdF, setThresholdF] = useState(95);
  const [granularity, setGranularity] = useState(100);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const nextSites = loadSites(location);
    setSites(nextSites);
    setSelectedSiteId((current) => current && nextSites.some((site) => site.id === current)
      ? current
      : loadSelectedSiteId(nextSites));
  }, [location?.site_id, location?.latitude, location?.longitude]);

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) || null,
    [selectedSiteId, sites],
  );
  const boundaryReady = Boolean(selectedSite?.polygon?.length >= 3);
  const areaAcres = selectedSite ? polygonAreaAcres(selectedSite.polygon) : null;

  function chooseSite(event) {
    const siteId = event.target.value;
    setSelectedSiteId(siteId);
    saveSelectedSiteId(siteId);
    setResult(null);
    setError(null);
  }

  async function analyze() {
    if (!selectedSite) {
      setError("Select a saved site before running Heat History.");
      return;
    }
    if (!boundaryReady) {
      setError("This site has no complete boundary. Open Site Setup and draw the full site polygon first.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const next = await analyzeSiteHeatHistory({
        site: selectedSite,
        days,
        thresholdF,
        granularity,
      });
      setResult(next);
    } catch (analysisError) {
      setError(analysisError?.message || "Historical heat analysis failed for this site.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hs-screen hs-history-screen">
      <section className="hs-history-heading">
        <div>
          <span className="hs-history-eyebrow">FORTYGUARD HISTORICAL INTELLIGENCE</span>
          <h1>Site Heat History</h1>
          <p>Choose a saved worksite first. HeatShield sends that site&apos;s full boundary to FortyGuard and keeps zone analysis optional.</p>
        </div>
        <div className="hs-history-provider-badge"><ShieldCheck /> U.S. historical coverage</div>
      </section>

      <section className="hs-history-site-card">
        <div className="hs-history-site-selector">
          <label htmlFor="heat-history-site">Site to analyze</label>
          <select id="heat-history-site" value={selectedSiteId || ""} onChange={chooseSite}>
            {!sites.length ? <option value="">No saved sites</option> : null}
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name || site.id}</option>)}
          </select>
          {selectedSite ? (
            <div className="hs-history-site-meta">
              <strong>{selectedSite.name || selectedSite.id}</strong>
              <span>{selectedSite.address || [selectedSite.city, selectedSite.state].filter(Boolean).join(", ") || "Saved worksite"}</span>
              <div>
                <span className={boundaryReady ? "ready" : "missing"}>{boundaryReady ? <CheckCircle2 /> : <AlertTriangle />}{boundaryReady ? "Full site boundary ready" : "Boundary required"}</span>
                <span><MapPinned />{areaAcres ? `${formatNumber(areaAcres, 1)} acres` : "Area unavailable"}</span>
                <span>{zoneCount(selectedSite)} zones · optional</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="hs-history-map-preview">
          {selectedSite ? (
            <GoogleSiteMap
              site={selectedSite}
              crew={[]}
              heatFeatures={result?.latestFeatures || []}
              heatVisible={Boolean(result?.latestFeatures?.length)}
              mapType="satellite"
              onMapClick={() => {}}
            />
          ) : <div className="hs-history-map-empty"><MapPinned />Select a saved site to preview its boundary.</div>}
        </div>
      </section>

      <section className="hs-history-controls">
        <div className="hs-history-control-group period">
          <label>Analysis period</label>
          <div className="hs-history-segments">
            {[7, 30, 90].map((value) => (
              <button key={value} type="button" className={days === value ? "active" : ""} onClick={() => { setDays(value); setResult(null); }}>{`Last ${value} days`}</button>
            ))}
          </div>
        </div>
        <div className="hs-history-control-group">
          <label htmlFor="heat-history-threshold">Heat threshold</label>
          <div className="hs-history-input-wrap"><input id="heat-history-threshold" type="number" min="70" max="130" value={thresholdF} onChange={(event) => setThresholdF(event.target.value)} /><span>°F</span></div>
          <small>{formatNumber((Number(thresholdF) - 32) * 5 / 9, 1)}°C sent to the comparison layer</small>
        </div>
        <div className="hs-history-control-group">
          <label htmlFor="heat-history-resolution">Spatial resolution</label>
          <select id="heat-history-resolution" value={granularity} onChange={(event) => setGranularity(Number(event.target.value))}>
            <option value={100}>100 m · credit-aware</option>
            <option value={50}>50 m · detailed</option>
          </select>
          <small>Same resolution for all provider samples</small>
        </div>
        <button className="hs-history-analyze" type="button" disabled={busy || !selectedSite || !boundaryReady} onClick={analyze}>
          {busy ? <LoaderCircle className="spinner" /> : <Sparkles />}
          {busy ? "Analyzing site history…" : "Analyze selected site"}
        </button>
      </section>

      {error ? <section className="hs-history-state error"><AlertTriangle /><div><strong>Historical analysis unavailable</strong><p>{error}</p></div></section> : null}

      {!result && !error ? (
        <section className="hs-history-state">
          <History />
          <div>
            <strong>{selectedSite ? `Ready to analyze ${selectedSite.name || selectedSite.id}` : "Choose a site to begin"}</strong>
            <p>{boundaryReady ? "HeatShield will request three sequential historical FortyGuard samples for the selected site boundary. Zones are not required for whole-site analysis." : "A saved polygon with at least three points is required so HeatShield never analyzes an ambiguous point location."}</p>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="hs-history-results">
          <div className="hs-history-results-title">
            <div><span className="hs-history-eyebrow">SELECTED SITE EVIDENCE</span><h2>How does {result.siteName} behave during hot afternoons?</h2></div>
            <span>{result.completedSamples}/{result.requestedSamples} provider samples · 14:00 local request time</span>
          </div>
          <div className="hs-history-metrics">
            <article><ThermometerSun /><span>Mean sampled heat</span><strong>{formatNumber(fFromC(result.meanC), 1)}°F</strong><small>Across {result.featureCount} populated cells</small></article>
            <article><ThermometerSun /><span>Peak sampled cell</span><strong>{formatNumber(fFromC(result.peakC), 1)}°F</strong><small>Highest provider cell in this run</small></article>
            <article><History /><span>Threshold recurrence</span><strong>{formatNumber(result.exceedancePercent, 0)}%</strong><small>Cells at or above {result.thresholdF}°F</small></article>
          </div>
          <div className="hs-history-samples">
            {result.samples.map((sample) => (
              <div key={sample.date}><strong>{sample.date}</strong><span>{sample.features.length} populated cells</span><small>{sample.activityId ? `Activity ${sample.activityId}` : "Activity ID unavailable"}</small></div>
            ))}
          </div>
          {result.failures.length ? <div className="hs-history-partial"><AlertTriangle />Some requested dates had no populated provider cells. HeatShield used only returned FortyGuard evidence and did not fabricate missing history.</div> : null}
        </section>
      ) : null}
    </div>
  );
}
