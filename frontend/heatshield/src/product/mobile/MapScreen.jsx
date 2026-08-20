import {
  ArrowRight,
  CloudSun,
  LocateFixed,
  LoaderCircle,
  MapPinned,
  Search,
  ShieldAlert,
  ShieldCheck,
  SunMedium,
  ThermometerSun,
  Zap,
} from "lucide-react";
import SelectableHeatMap from "../../components/map/SelectableHeatMap.jsx";
import { BAND_LABEL, finite, metric } from "../productUtils.js";

function cToF(value) {
  const parsed = finite(value);
  return parsed === null ? null : (parsed * 9) / 5 + 32;
}

function rounded(value) {
  return finite(value) === null ? "--" : Math.round(Number(value));
}

export default function MapScreen({
  location,
  fortyGuardSupported,
  cycle,
  weather,
  heatmapState,
  query,
  setQuery,
  searchResults,
  searching,
  onSearch,
  onChooseLocation,
  onPickMap,
  onUseCurrentLocation,
  analysisBusy,
  onAnalyze,
  onNavigate,
}) {
  const env = cycle?.current_assessment?.environmental_evidence;
  const screening = cycle?.current_assessment?.screening;
  const candidates = cycle?.spatial_heat?.candidates ?? [];
  const cooler = candidates[0];
  const weatherTempF = cToF(weather?.current?.temperature_2m_c);
  const locationLabel = [location?.city, location?.state, location?.country]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="hs-screen hs-map-screen">
      <div className="hs-screen-title hs-map-title">
        <div>
          <span>Heat explorer</span>
          <h1>Check any place. Unlock worksite heat where FortyGuard is available.</h1>
          <p>Use your current location, search anywhere, or tap the map. U.S. worksites can be scanned with FortyGuard for hyperlocal occupational heat intelligence.</p>
        </div>
      </div>

      <div className="hs-location-tools">
        <form className="hs-search-bar" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="City, address, landmark, or coordinates" />
          <button type="submit" disabled={searching}>{searching ? <LoaderCircle className="spinner" size={17} /> : "Find"}</button>
        </form>
        <button className="hs-current-location-button" type="button" onClick={onUseCurrentLocation} disabled={searching}>
          {searching ? <LoaderCircle className="spinner" size={18} /> : <LocateFixed size={18} />}
          <span>Use my location</span>
        </button>
      </div>

      {searchResults?.length ? (
        <div className="hs-search-results hs-global-search-results">
          {searchResults.map((item) => (
            <button key={`${item.site_id}-${item.latitude}`} type="button" onClick={() => onChooseLocation(item)}>
              <MapPinned size={16} />
              <span>
                <strong>{item.name}</strong>
                <small>{item.display_name}</small>
              </span>
              <em className={item.fortyguard_supported ? "supported" : "weather-only"}>
                {item.fortyguard_supported ? "FortyGuard" : "Weather only"}
              </em>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      ) : null}

      <div className={`hs-coverage-strip ${fortyGuardSupported ? "supported" : "weather-only"}`}>
        {fortyGuardSupported ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
        <div>
          <strong>{fortyGuardSupported ? "FortyGuard heat intelligence available" : "Weather context only at this location"}</strong>
          <span>{fortyGuardSupported ? "Scan this exact point to load provider-backed worksite heat cells, nearby lower-heat candidates, and the operational plan." : "You can still view general weather here. Select a U.S. worksite to unlock FortyGuard occupational heat intelligence."}</span>
        </div>
      </div>

      <SelectableHeatMap
        location={location}
        fortyGuardSupported={fortyGuardSupported}
        heatmapState={heatmapState}
        spatialCandidates={candidates}
        onPick={onPickMap}
        picking={searching}
      />

      <section className="hs-map-summary-grid hs-map-intelligence-grid">
        <article className="hs-map-summary hs-map-weather">
          <span className="hs-summary-icon"><CloudSun size={22} /></span>
          <div>
            <span>Selected location</span>
            <strong>{rounded(weatherTempF)}°F air</strong>
            <small>{locationLabel || `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`} · Open-Meteo context</small>
          </div>
        </article>

        <article className={`hs-map-summary ${fortyGuardSupported ? "hs-map-current" : "hs-map-unavailable"}`}>
          <span className="hs-summary-icon"><ThermometerSun size={22} /></span>
          <div>
            <span>FortyGuard worksite heat</span>
            <strong>
              {!fortyGuardSupported
                ? "Not available here"
                : finite(env?.temperature_c) === null
                  ? "Ready to scan"
                  : `${metric(env.temperature_c)}°C`}
            </strong>
            <small>
              {!fortyGuardSupported
                ? "Current FortyGuard product coverage is limited to supported U.S. locations."
                : cycle
                  ? `${BAND_LABEL[screening?.band] ?? "Screening unavailable"} · Heat Index ${metric(env?.heat_index_c)}°C`
                  : "Run the worksite scan for provider-backed heat evidence."}
            </small>
          </div>
        </article>

        {fortyGuardSupported ? (
          <article className="hs-map-summary hs-map-cooler hs-map-candidate-card">
            <span className="hs-summary-icon"><MapPinned size={22} /></span>
            <div>
              <span>Best lower-heat mapped candidate</span>
              <strong>{cooler ? `${metric(cooler.temperature_c)}°C` : "Not checked yet"}</strong>
              <small>{cooler ? `${metric(cooler.cooler_by_c)}°C lower than the selected tile · ${Math.round(cooler.straight_line_distance_m)} m straight-line. This is comparative heat evidence, not a safety determination.` : "Scan the worksite to compare nearby FortyGuard tiles."}</small>
            </div>
          </article>
        ) : null}
      </section>

      {fortyGuardSupported && !cycle ? (
        <button className="hs-primary-cta hs-map-scan-cta" type="button" onClick={onAnalyze} disabled={analysisBusy}>
          {analysisBusy ? <LoaderCircle className="spinner" size={19} /> : <Zap size={19} />}
          <span><strong>{analysisBusy ? "Scanning this worksite…" : "Scan this worksite with FortyGuard"}</strong><small>Load hyperlocal heat, nearby comparison tiles, and the operational recommendation</small></span>
          <ArrowRight size={18} />
        </button>
      ) : null}

      {fortyGuardSupported && cycle ? (
        <button className="hs-soft-action" type="button" onClick={() => onNavigate("plan")}><SunMedium size={17} /> Review the work recommendation <ArrowRight size={16} /></button>
      ) : null}
    </div>
  );
}
