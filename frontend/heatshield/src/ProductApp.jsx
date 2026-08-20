import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PHOENIX_LOCATION } from "./api/heatshieldApi.js";
import {
  approveCycleActions,
  fetchAgenticCycle,
  recheckCycle,
  reverseLocation,
  searchLocations,
  verifyCycle,
} from "./api/agenticApi.js";
import { fetchWeatherContext } from "./api/weatherContextApi.js";
import { mapStateFromCycle } from "./product/productUtils.js";
import AppShell from "./product/mobile/AppShell.jsx";
import TodayScreen from "./product/mobile/TodayScreen.jsx";
import MapScreen from "./product/mobile/MapScreen.jsx";
import PlanScreen from "./product/mobile/PlanScreen.jsx";
import TeamScreen from "./product/mobile/TeamScreen.jsx";
import AlertsScreen from "./product/mobile/AlertsScreen.jsx";
import "./HeatShieldMobile.css";

const DEFAULT_WORK = {
  workerId: "WORKER-01",
  taskName: "Outdoor field work",
  workload: "moderate",
  duration: 60,
  ppe: "light",
  directSun: true,
  acclimatized: true,
};

export default function ProductApp() {
  const inFlight = useRef(false);
  const [activeTab, setActiveTab] = useState("today");
  const [location, setLocation] = useState({
    ...PHOENIX_LOCATION,
    display_name: "Phoenix, Arizona, United States",
  });
  const [query, setQuery] = useState("Phoenix, Arizona");
  const [searchResults, setSearchResults] = useState([]);
  const [locationBusy, setLocationBusy] = useState(false);
  const [cycle, setCycle] = useState(null);
  const [weather, setWeather] = useState(null);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [operationBusy, setOperationBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [work, setWork] = useState(DEFAULT_WORK);
  const [selected, setSelected] = useState([]);
  const [supervisor, setSupervisor] = useState("SUPERVISOR-01");
  const [approval, setApproval] = useState(null);
  const [verification, setVerification] = useState(null);

  const heatmapState = useMemo(() => mapStateFromCycle(cycle), [cycle]);

  useEffect(() => {
    let cancelled = false;
    setWeatherBusy(true);
    fetchWeatherContext(location)
      .then((result) => {
        if (!cancelled) setWeather(result);
      })
      .catch(() => {
        if (!cancelled) setWeather(null);
      })
      .finally(() => {
        if (!cancelled) setWeatherBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [location.latitude, location.longitude, location.timezone]);

  const resetCycleState = useCallback(() => {
    setCycle(null);
    setSelected([]);
    setApproval(null);
    setVerification(null);
  }, []);

  const chooseLocation = useCallback((next) => {
    setLocation(next);
    setQuery(next.display_name || `${next.name}, ${next.city}, ${next.state}`);
    setSearchResults([]);
    resetCycleState();
    setError(null);
    setMessage("Worksite updated. Run a heat check when the work plan is ready.");
  }, [resetCycleState]);

  async function findLocation() {
    setLocationBusy(true);
    setError(null);
    try {
      const coordinateMatch = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (coordinateMatch) {
        chooseLocation(await reverseLocation(Number(coordinateMatch[1]), Number(coordinateMatch[2])));
        return;
      }
      const result = await searchLocations(query);
      const items = result?.results ?? [];
      setSearchResults(items);
      if (!items.length) setError("No supported U.S. worksite matched that search.");
    } catch (lookupError) {
      setError(lookupError?.message ?? "Location search failed.");
    } finally {
      setLocationBusy(false);
    }
  }

  async function pickMap(latitude, longitude) {
    setLocationBusy(true);
    setError(null);
    try {
      chooseLocation(await reverseLocation(latitude, longitude));
    } catch (lookupError) {
      setError(lookupError?.message ?? "This map point could not be used.");
    } finally {
      setLocationBusy(false);
    }
  }

  async function analyze() {
    if (inFlight.current) return;
    inFlight.current = true;
    setAnalysisBusy(true);
    setError(null);
    setMessage(null);
    setApproval(null);
    setVerification(null);

    try {
      const [cycleResult, weatherResult] = await Promise.allSettled([
        fetchAgenticCycle(location, {
          worker: {
            worker_id: work.workerId || "WORKER-01",
            acclimatized: work.acclimatized,
            ppe_level: work.ppe,
          },
          task: {
            task_id: "FIELD-TASK-01",
            task_name: work.taskName,
            workload_level: work.workload,
            exposure_duration_minutes: work.duration,
            direct_sun: work.directSun,
          },
          forecastOffsetHours: [1, 3],
          includeSpatialIntelligence: true,
          spatialSearchRadiusMeters: 600,
          includeShiftOptimization: false,
        }),
        fetchWeatherContext(location, { force: true }),
      ]);

      if (weatherResult.status === "fulfilled") setWeather(weatherResult.value);
      if (cycleResult.status === "rejected") throw cycleResult.reason;

      const result = cycleResult.value;
      setCycle(result);
      setSelected(
        (result.agent_decision?.actions ?? [])
          .filter((action) => action.status === "proposed")
          .map((action) => action.action_id),
      );
      setMessage("Heat plan ready. Review the recommended controls before approval.");
    } catch (analysisError) {
      setCycle(null);
      setSelected([]);
      setError(analysisError?.message ?? "Heat analysis failed for this worksite.");
    } finally {
      inFlight.current = false;
      setAnalysisBusy(false);
    }
  }

  async function approveSelected() {
    if (!cycle?.cycle_id || !selected.length) return;
    setOperationBusy("approve");
    setError(null);
    try {
      const result = await approveCycleActions(cycle.cycle_id, selected, supervisor);
      setApproval(result);
      const recordedCount = (result.results ?? []).filter((item) =>
        ["executed", "already_executed"].includes(item.status),
      ).length;
      setMessage(
        recordedCount
          ? `${recordedCount} control${recordedCount === 1 ? "" : "s"} recorded for this cycle.`
          : "Approval completed, but no control was recorded. Review the result before continuing.",
      );
      setActiveTab("alerts");
    } catch (operationError) {
      setError(operationError?.message ?? "Approval failed.");
    } finally {
      setOperationBusy(null);
    }
  }

  async function verifyNow() {
    if (!cycle?.cycle_id) return;
    setOperationBusy("verify");
    setError(null);
    try {
      const result = await verifyCycle(cycle.cycle_id);
      setVerification(result);
      setMessage("Fresh provider evidence was checked against the recorded actions.");
    } catch (operationError) {
      setError(operationError?.message ?? "Verification failed.");
    } finally {
      setOperationBusy(null);
    }
  }

  async function refreshPlan() {
    if (!cycle?.cycle_id) return;
    setOperationBusy("recheck");
    setError(null);
    try {
      const [successor, latestWeather] = await Promise.all([
        recheckCycle(cycle.cycle_id),
        fetchWeatherContext(location, { force: true }).catch(() => null),
      ]);
      setCycle(successor);
      if (latestWeather) setWeather(latestWeather);
      setSelected(
        (successor.agent_decision?.actions ?? [])
          .filter((action) => action.status === "proposed")
          .map((action) => action.action_id),
      );
      setApproval(null);
      setVerification(null);
      setMessage("Fresh heat evidence loaded and the plan was rebuilt.");
      setActiveTab("today");
    } catch (operationError) {
      setError(operationError?.message ?? "Refresh failed.");
    } finally {
      setOperationBusy(null);
    }
  }

  const shared = {
    location,
    cycle,
    weather,
    weatherBusy,
    heatmapState,
    work,
    setWork,
    selected,
    setSelected,
    approval,
    verification,
    supervisor,
    setSupervisor,
    analysisBusy,
    operationBusy,
    onAnalyze: analyze,
    onApprove: approveSelected,
    onVerify: verifyNow,
    onRefresh: refreshPlan,
    onNavigate: setActiveTab,
  };

  return (
    <AppShell
      activeTab={activeTab}
      onNavigate={setActiveTab}
      location={location}
      cycle={cycle}
      message={message}
      error={error}
      onDismissMessage={() => setMessage(null)}
      onDismissError={() => setError(null)}
    >
      {activeTab === "today" ? <TodayScreen {...shared} /> : null}
      {activeTab === "map" ? (
        <MapScreen
          {...shared}
          query={query}
          setQuery={setQuery}
          searchResults={searchResults}
          searching={locationBusy}
          onSearch={findLocation}
          onChooseLocation={chooseLocation}
          onPickMap={pickMap}
        />
      ) : null}
      {activeTab === "plan" ? <PlanScreen {...shared} /> : null}
      {activeTab === "team" ? <TeamScreen {...shared} /> : null}
      {activeTab === "alerts" ? <AlertsScreen {...shared} /> : null}
    </AppShell>
  );
}
