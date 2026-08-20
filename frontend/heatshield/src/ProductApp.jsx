import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Crosshair, LoaderCircle, MapPinned,
  Shield, Sparkles, Zap,
} from "lucide-react";

import { PHOENIX_LOCATION } from "./api/heatshieldApi.js";
import {
  fetchAgenticCycle,
  recheckCycle,
  reverseLocation,
  searchLocations,
} from "./api/agenticApi.js";
import SelectableHeatMap from "./components/map/SelectableHeatMap.jsx";
import { Sidebar, SearchLocation, WorkContext } from "./product/ProductSetup.jsx";
import { ApprovalVerify, AgentPlan } from "./product/ProductResults.jsx";
import ProductWeather from "./product/ProductWeather.jsx";
import { fetchWeatherContext } from "./api/weatherContextApi.js";
import { locationLabel, mapStateFromCycle } from "./product/productUtils.js";
import "./App.css";
import "./ProductApp.css";
import "./ProductV4.css";

export default function ProductApp() {
  const inFlight = useRef(false);
  const [location, setLocation] = useState({ ...PHOENIX_LOCATION, display_name: "Phoenix, Arizona, United States" });
  const [query, setQuery] = useState("Phoenix, Arizona");
  const [searchResults, setSearchResults] = useState([]);
  const [locationBusy, setLocationBusy] = useState(false);
  const [cycle, setCycle] = useState(null);
  const [weather, setWeather] = useState(null);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [error, setError] = useState(null);
  const [weatherWarning, setWeatherWarning] = useState(null);
  const [notice, setNotice] = useState(null);
  const [work, setWork] = useState({ taskName: "Outdoor field work", workload: "moderate", duration: 60, ppe: "light", directSun: true, acclimatized: true });
  const [selected, setSelected] = useState([]);
  const [approval, setApproval] = useState(null);
  const [verification, setVerification] = useState(null);

  const heatmapState = useMemo(() => mapStateFromCycle(cycle), [cycle]);

  useEffect(() => {
    let cancelled = false;
    setWeatherBusy(true);
    setWeatherWarning(null);
    fetchWeatherContext(location)
      .then((result) => { if (!cancelled) setWeather(result); })
      .catch((contextError) => {
        if (!cancelled) {
          setWeather(null);
          setWeatherWarning(contextError?.message ?? "Secondary weather context is unavailable.");
        }
      })
      .finally(() => { if (!cancelled) setWeatherBusy(false); });
    return () => { cancelled = true; };
  }, [location.latitude, location.longitude, location.timezone]);

  const chooseLocation = useCallback((next) => {
    setLocation(next);
    setQuery(locationLabel(next));
    setSearchResults([]);
    setCycle(null);
    setSelected([]);
    setApproval(null);
    setVerification(null);
    setError(null);
    setNotice("Worksite selected. Weather context is loading; run Heat Check when the work conditions are ready.");
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
    inFlight.current = true;
    setAnalysisBusy(true);
    setError(null);
    setNotice(null);
    setApproval(null);
    setVerification(null);

    try {
      const [cycleResult, weatherResult] = await Promise.allSettled([
        fetchAgenticCycle(location, {
          worker: { worker_id: "WORKER-01", acclimatized: work.acclimatized, ppe_level: work.ppe },
          task: { task_id: "FIELD-TASK-01", task_name: work.taskName, workload_level: work.workload, exposure_duration_minutes: work.duration, direct_sun: work.directSun },
          forecastOffsetHours: [1, 3],
          includeSpatialIntelligence: true,
          spatialSearchRadiusMeters: 600,
          includeShiftOptimization: false,
        }),
        fetchWeatherContext(location),
      ]);

      if (weatherResult.status === "fulfilled") {
        setWeather(weatherResult.value);
        setWeatherWarning(null);
      } else {
        setWeatherWarning(weatherResult.reason?.message ?? "Secondary weather context is unavailable.");
      }

      if (cycleResult.status === "rejected") throw cycleResult.reason;
      const result = cycleResult.value;
      setCycle(result);
      setSelected((result.agent_decision?.actions ?? []).filter((action) => action.status === "proposed").map((action) => action.action_id));
      setNotice("FortyGuard heat evidence and the supervisor-ready agent plan are ready.");
    } catch (analysisError) {
      setCycle(null);
      setSelected([]);
      setError(analysisError?.message ?? "Heat analysis failed for this location.");
    } finally {
      inFlight.current = false;
      setAnalysisBusy(false);
    }
  }

  async function recheck() {
    if (!cycle?.cycle_id) return;
    const [successor, latestWeather] = await Promise.all([
      recheckCycle(cycle.cycle_id),
      fetchWeatherContext(location, { force: true }).catch(() => null),
    ]);
    setCycle(successor);
    if (latestWeather) setWeather(latestWeather);
    setSelected((successor.agent_decision?.actions ?? []).filter((action) => action.status === "proposed").map((action) => action.action_id));
    setApproval(null);
    setVerification(null);
    setNotice("Fresh heat evidence loaded and the agent rebuilt the plan.");
  }

  return (
    <div className="product-shell product-v4-shell">
      <Sidebar cycle={cycle} approval={approval} verification={verification} />
      <main className="product-main product-v4-main">
        <header className="product-topbar product-v4-topbar">
          <div>
            <span className="product-eyebrow">HEAT OPERATIONS</span>
            <h1>Make the next outdoor-work decision with current heat evidence</h1>
            <p>Choose the exact worksite, describe the job, then get a clear supervisor-controlled plan grounded in FortyGuard heat evidence.</p>
          </div>
          <div className="product-v4-status"><Sparkles size={17} /><div><strong>{cycle ? "Heat plan ready" : weatherBusy ? "Loading worksite context" : "Select worksite & job"}</strong><span>FortyGuard primary · weather context secondary</span></div></div>
        </header>

        <SearchLocation value={query} onChange={setQuery} onSearch={findLocation} searching={locationBusy} results={searchResults} onChoose={chooseLocation} />
        {error ? <div className="product-global-error"><AlertTriangle size={17} />{error}</div> : null}
        {notice ? <div className="product-global-notice"><CheckCircle2 size={17} />{notice}</div> : null}
        {weatherWarning ? <div className="product-context-warning"><AlertTriangle size={15} />{weatherWarning} HeatShield can still run when FortyGuard is available.</div> : null}

        <section className="product-location-strip">
          <div><MapPinned size={19} /><div><span>Selected worksite</span><strong>{locationLabel(location)}</strong><small>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)} · {location.timezone}</small></div></div>
          <div><Crosshair size={17} /><span>Search or click map to change</span></div>
        </section>

        <ProductWeather cycle={cycle} weather={weather} work={work} location={location} />

        <div className="product-setup-grid product-v4-setup-grid">
          <SelectableHeatMap location={location} heatmapState={heatmapState} onPick={pickMap} picking={locationBusy} />
          <div className="product-work-column">
            <WorkContext work={work} setWork={setWork} />
            <button type="button" className="product-analyze" onClick={analyze} disabled={analysisBusy || locationBusy}>
              {analysisBusy ? <LoaderCircle className="spinner" size={19} /> : <Zap size={19} />}
              <div><strong>{analysisBusy ? "Building the current heat plan..." : "Check heat & build plan"}</strong><span>{analysisBusy ? "FortyGuard current heat + nearby cooler tiles + +1h/+3h samples + agent plan" : "Uses this exact worksite and job context"}</span></div>
              {!analysisBusy ? <ArrowRight size={18} /> : null}
            </button>
            <div className="product-analysis-note"><Sparkles size={15} /><span>Weather context can appear first. The heat screening and agent actions are not shown until current FortyGuard evidence is available.</span></div>
          </div>
        </div>

        <AgentPlan cycle={cycle} selected={selected} setSelected={setSelected} />
        <ApprovalVerify cycle={cycle} selected={selected} approval={approval} setApproval={setApproval} verification={verification} setVerification={setVerification} onRecheck={recheck} />

        <footer className="product-footer">
          <div><Shield size={15} /> FortyGuard is the primary heat evidence source. Human approval is required before operational controls are recorded.</div>
          <div>Heat Index is screening · cooler ≠ safe · wet-bulb ≠ WBGT · weather context ≠ heat evidence · verification ≠ causal proof</div>
        </footer>
      </main>
    </div>
  );
}
