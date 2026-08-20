import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Crosshair, LoaderCircle, MapPinned,
  Shield, Sparkles, ThermometerSun, Zap,
} from "lucide-react";

import { PHOENIX_LOCATION } from "./api/heatshieldApi.js";
import { fetchAgenticCycle, recheckCycle, reverseLocation, searchLocations } from "./api/agenticApi.js";
import SelectableHeatMap from "./components/map/SelectableHeatMap.jsx";
import { Sidebar, SearchLocation, WorkContext } from "./product/ProductSetup.jsx";
import { ApprovalVerify, AgentPlan, HeatSummary } from "./product/ProductResults.jsx";
import { finite, locationLabel, mapStateFromCycle, metric } from "./product/productUtils.js";
import "./App.css";
import "./ProductApp.css";

export default function ProductApp() {
  const inFlight = useRef(false);
  const [location, setLocation] = useState({ ...PHOENIX_LOCATION, display_name: "Phoenix, Arizona, United States" });
  const [query, setQuery] = useState("Phoenix, Arizona");
  const [searchResults, setSearchResults] = useState([]);
  const [locationBusy, setLocationBusy] = useState(false);
  const [cycle, setCycle] = useState(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [work, setWork] = useState({ taskName: "Outdoor field work", workload: "moderate", duration: 60, ppe: "light", directSun: true, acclimatized: true });
  const [selected, setSelected] = useState([]);
  const [approval, setApproval] = useState(null);
  const [verification, setVerification] = useState(null);

  const heatmapState = useMemo(() => mapStateFromCycle(cycle), [cycle]);

  const chooseLocation = useCallback((next) => {
    setLocation(next);
    setQuery(locationLabel(next));
    setSearchResults([]);
    setCycle(null);
    setSelected([]);
    setApproval(null);
    setVerification(null);
    setError(null);
    setNotice("Worksite selected. Check heat when the work conditions are ready.");
  }, []);

  async function findLocation() {
    setLocationBusy(true); setError(null); setNotice(null);
    try {
      const coordinateMatch = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (coordinateMatch) {
        chooseLocation(await reverseLocation(Number(coordinateMatch[1]), Number(coordinateMatch[2])));
      } else {
        const result = await searchLocations(query);
        const items = result?.results ?? [];
        setSearchResults(items);
        if (!items.length) setError("No U.S. location matched that search.");
      }
    } catch (lookupError) {
      setError(lookupError?.message ?? "Location search failed.");
    } finally { setLocationBusy(false); }
  }

  async function pickMap(latitude, longitude) {
    setLocationBusy(true); setError(null); setNotice(null);
    try { chooseLocation(await reverseLocation(latitude, longitude)); }
    catch (lookupError) { setError(lookupError?.message ?? "This map point could not be used."); }
    finally { setLocationBusy(false); }
  }

  async function analyze() {
    if (inFlight.current) return;
    inFlight.current = true; setAnalysisBusy(true); setError(null); setNotice(null); setApproval(null); setVerification(null);
    try {
      const result = await fetchAgenticCycle(location, {
        worker: { worker_id: "WORKER-01", acclimatized: work.acclimatized, ppe_level: work.ppe },
        task: { task_id: "FIELD-TASK-01", task_name: work.taskName, workload_level: work.workload, exposure_duration_minutes: work.duration, direct_sun: work.directSun },
        forecastOffsetHours: [1, 3],
        includeSpatialIntelligence: true,
        spatialSearchRadiusMeters: 600,
        includeShiftOptimization: false,
      });
      setCycle(result);
      setSelected((result.agent_decision?.actions ?? []).filter((action) => action.status === "proposed").map((action) => action.action_id));
      setNotice("Current heat and agent plan are ready.");
    } catch (analysisError) {
      setCycle(null); setSelected([]);
      setError(analysisError?.message ?? "Heat analysis failed for this location.");
    } finally {
      inFlight.current = false; setAnalysisBusy(false);
    }
  }

  async function recheck() {
    if (!cycle?.cycle_id) return;
    const successor = await recheckCycle(cycle.cycle_id);
    setCycle(successor);
    setSelected((successor.agent_decision?.actions ?? []).filter((action) => action.status === "proposed").map((action) => action.action_id));
    setApproval(null); setVerification(null);
    setNotice("Fresh heat evidence loaded and the agent rebuilt the plan.");
  }

  const env = cycle?.current_assessment?.environmental_evidence;

  return (
    <div className="product-shell">
      <Sidebar cycle={cycle} approval={approval} verification={verification} />
      <main className="product-main">
        <header className="product-topbar">
          <div><span className="product-eyebrow">HEAT OPERATIONS</span><h1>Protect outdoor work with a clear heat action plan</h1><p>Select the exact worksite, describe the task, then let HeatShield turn FortyGuard evidence into supervisor-controlled actions.</p></div>
          <div className="product-current-temp"><ThermometerSun size={21} /><div><strong>{metric(env?.temperature_c)}{finite(env?.temperature_c) !== null ? "°C" : ""}</strong><span>{cycle ? "Current worksite" : "Awaiting heat check"}</span></div></div>
        </header>

        <SearchLocation value={query} onChange={setQuery} onSearch={findLocation} searching={locationBusy} results={searchResults} onChoose={chooseLocation} />
        {error ? <div className="product-global-error"><AlertTriangle size={17} />{error}</div> : null}
        {notice ? <div className="product-global-notice"><CheckCircle2 size={17} />{notice}</div> : null}

        <section className="product-location-strip">
          <div><MapPinned size={19} /><div><span>Selected worksite</span><strong>{locationLabel(location)}</strong><small>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)} · {location.timezone}</small></div></div>
          <div><Crosshair size={17} /><span>Search or click map to change</span></div>
        </section>

        <div className="product-setup-grid">
          <SelectableHeatMap location={location} heatmapState={heatmapState} onPick={pickMap} picking={locationBusy} />
          <div className="product-work-column">
            <WorkContext work={work} setWork={setWork} />
            <button type="button" className="product-analyze" onClick={analyze} disabled={analysisBusy || locationBusy}>
              {analysisBusy ? <LoaderCircle className="spinner" size={19} /> : <Zap size={19} />}
              <div><strong>{analysisBusy ? "Checking heat and building plan..." : "Check heat & build plan"}</strong><span>{analysisBusy ? "Current heat → nearby cooler options → +1h/+3h samples → agent plan" : "Uses the selected worksite and work conditions"}</span></div>
              {!analysisBusy ? <ArrowRight size={18} /> : null}
            </button>
            <div className="product-analysis-note"><Sparkles size={15} /><span>No automatic historical replay. If current provider evidence is unavailable, HeatShield tells you instead of showing stale data.</span></div>
          </div>
        </div>

        <HeatSummary cycle={cycle} />
        <AgentPlan cycle={cycle} selected={selected} setSelected={setSelected} />
        <ApprovalVerify cycle={cycle} selected={selected} approval={approval} setApproval={setApproval} verification={verification} setVerification={setVerification} onRecheck={recheck} />

        <footer className="product-footer">
          <div><Shield size={15} /> Human approval is required before operational actions are recorded.</div>
          <div>Heat Index is a screening metric · cooler ≠ safe · wet-bulb ≠ WBGT · verification ≠ causal proof</div>
        </footer>
      </main>
    </div>
  );
}
