import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  approveCycleActions,
  fetchAgenticCycle,
  locationSupportsFortyGuard,
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

function browserPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!window.navigator?.geolocation) {
      reject(new Error("This browser does not provide location access."));
      return;
    }

    window.navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: options.timeout ?? 12_000,
      maximumAge: options.maximumAge ?? 60_000,
    });
  });
}

function normalizeLocation(next) {
  const latitude = Number(next?.latitude);
  const longitude = Number(next?.longitude);
  const generatedSiteId = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `AUTO-${latitude.toFixed(4)}-${longitude.toFixed(4)}`.replace(/[^A-Za-z0-9._-]/g, "_")
    : "AUTO-WORKSITE";

  return {
    ...next,
    site_id: next?.site_id || generatedSiteId,
    name: next?.name || next?.city || "Current worksite",
    display_name:
      next?.display_name ||
      [next?.name, next?.city, next?.state, next?.country].filter(Boolean).join(", "),
    fortyguard_supported: locationSupportsFortyGuard(next),
  };
}

export default function ProductApp() {
  const inFlight = useRef(false);
  const initialLocationStarted = useRef(false);
  const [activeTab, setActiveTab] = useState("today");
  const [location, setLocation] = useState(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [locationBusy, setLocationBusy] = useState(true);
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
  const fortyGuardSupported = useMemo(
    () => locationSupportsFortyGuard(location),
    [location],
  );

  const resetCycleState = useCallback(() => {
    setCycle(null);
    setSelected([]);
    setApproval(null);
    setVerification(null);
  }, []);

  const applyLocation = useCallback((next, { showMessage = true } = {}) => {
    const normalized = normalizeLocation(next);
    setLocation(normalized);
    setQuery(normalized.display_name || normalized.name || "");
    setSearchResults([]);
    resetCycleState();
    setError(null);

    if (showMessage) {
      setMessage(
        normalized.fortyguard_supported
          ? "Worksite selected. Loading current FortyGuard heat intelligence."
          : "Location selected. Loading current weather context for this place.",
      );
    } else {
      setMessage(null);
    }

    return normalized;
  }, [resetCycleState]);

  useEffect(() => {
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    const timezone = String(location?.timezone ?? "").trim();

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !timezone) {
      setWeather(null);
      setWeatherBusy(false);
      return undefined;
    }

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
  }, [location?.latitude, location?.longitude, location?.timezone]);

  const runAnalysis = useCallback(async (
    targetLocation,
    { navigateOnUnsupported = false, showMessage = true } = {},
  ) => {
    const target = targetLocation || location;

    if (!target) {
      setError("HeatShield is still detecting your location.");
      return null;
    }

    if (!locationSupportsFortyGuard(target)) {
      if (navigateOnUnsupported) {
        setError("FortyGuard worksite heat intelligence is currently available for U.S. locations. General weather context is still shown for your selected location.");
        setActiveTab("map");
      }
      return null;
    }

    if (inFlight.current) return null;
    inFlight.current = true;
    setAnalysisBusy(true);
    setError(null);
    if (showMessage) setMessage("Loading current worksite heat evidence…");
    setApproval(null);
    setVerification(null);

    try {
      const [cycleResult, weatherResult] = await Promise.allSettled([
        fetchAgenticCycle(target, {
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
        fetchWeatherContext(target, { force: true }),
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

      if (showMessage) {
        setMessage("Current FortyGuard heat evidence and worksite recommendations are ready.");
      } else {
        setMessage(null);
      }

      return result;
    } catch (analysisError) {
      setCycle(null);
      setSelected([]);
      setError(analysisError?.message ?? "Heat analysis failed for this worksite.");
      return null;
    } finally {
      inFlight.current = false;
      setAnalysisBusy(false);
    }
  }, [location, work]);

  const selectLocation = useCallback(async (
    next,
    { navigateTo = null, showMessage = true, autoAnalyze = true } = {},
  ) => {
    const normalized = applyLocation(next, { showMessage });
    if (navigateTo) setActiveTab(navigateTo);

    if (autoAnalyze && normalized.fortyguard_supported) {
      await runAnalysis(normalized, { showMessage });
    }

    return normalized;
  }, [applyLocation, runAnalysis]);

  const useCurrentLocation = useCallback(async (
    { stayOnToday = false, showMessage = true } = {},
  ) => {
    setLocationBusy(true);
    setError(null);

    try {
      const position = await browserPosition({
        timeout: 12_000,
        maximumAge: 60_000,
      });
      const next = await reverseLocation(
        position.coords.latitude,
        position.coords.longitude,
      );

      const normalized = applyLocation({
        ...next,
        location_source: "browser_geolocation+reverse_geocoding",
      }, { showMessage });

      setActiveTab(stayOnToday ? "today" : "map");
      setLocationBusy(false);

      if (normalized.fortyguard_supported) {
        await runAnalysis(normalized, { showMessage });
      }
    } catch (locationError) {
      const denied = locationError?.code === 1;
      setError(
        denied
          ? "Location permission was not granted. Allow location access, then use the location button or search for your worksite."
          : locationError?.message ?? "Your current location could not be resolved.",
      );
    } finally {
      setLocationBusy(false);
    }
  }, [applyLocation, runAnalysis]);

  useEffect(() => {
    if (initialLocationStarted.current) return;
    initialLocationStarted.current = true;
    void useCurrentLocation({ stayOnToday: true, showMessage: false });
  }, [useCurrentLocation]);

  async function findLocation() {
    setLocationBusy(true);
    setError(null);

    try {
      const coordinateMatch = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (coordinateMatch) {
        const next = await reverseLocation(Number(coordinateMatch[1]), Number(coordinateMatch[2]));
        setLocationBusy(false);
        await selectLocation(next, { navigateTo: "today", autoAnalyze: true });
        return;
      }

      const result = await searchLocations(query);
      const items = result?.results ?? [];
      setSearchResults(items);
      if (!items.length) setError("No location matched that search.");
    } catch (lookupError) {
      setError(lookupError?.message ?? "Location search failed.");
    } finally {
      setLocationBusy(false);
    }
  }

  async function chooseSearchLocation(next) {
    setLocationBusy(false);
    await selectLocation(next, { navigateTo: "today", autoAnalyze: true });
  }

  async function pickMap(latitude, longitude) {
    setLocationBusy(true);
    setError(null);

    try {
      const next = await reverseLocation(latitude, longitude);
      setLocationBusy(false);
      await selectLocation(next, { navigateTo: "today", autoAnalyze: true });
    } catch (lookupError) {
      setError(lookupError?.message ?? "This map point could not be used.");
    } finally {
      setLocationBusy(false);
    }
  }

  const analyze = useCallback(async () => {
    await runAnalysis(location, { navigateOnUnsupported: true, showMessage: true });
  }, [location, runAnalysis]);

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
    locationBusy,
    fortyGuardSupported,
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
    onUseCurrentLocation: () => useCurrentLocation({ stayOnToday: false, showMessage: true }),
  };

  return (
    <AppShell
      activeTab={activeTab}
      onNavigate={setActiveTab}
      location={location}
      locationBusy={locationBusy}
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
          onChooseLocation={chooseSearchLocation}
          onPickMap={pickMap}
        />
      ) : null}
      {activeTab === "plan" ? <PlanScreen {...shared} /> : null}
      {activeTab === "checkin" ? (
        <div className="hs-screen">
          <section className="hs-checkin-placeholder">
            <h2>Worker Check-in</h2>
            <p>The navigation route is ready. We can build the full worker check-in screen next without breaking the new Home screen.</p>
          </section>
        </div>
      ) : null}
      {activeTab === "team" ? <TeamScreen {...shared} /> : null}
      {activeTab === "alerts" ? <AlertsScreen {...shared} /> : null}
    </AppShell>
  );
}
