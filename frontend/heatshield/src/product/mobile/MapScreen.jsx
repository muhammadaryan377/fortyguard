import {
  ArrowRight,
  LoaderCircle,
  MapPinned,
  Search,
  SunMedium,
  ThermometerSun,
  Zap,
} from "lucide-react";
import SelectableHeatMap from "../../components/map/SelectableHeatMap.jsx";
import { BAND_LABEL, finite, metric } from "../productUtils.js";

export default function MapScreen({
  location,
  cycle,
  heatmapState,
  query,
  setQuery,
  searchResults,
  searching,
  onSearch,
  onChooseLocation,
  onPickMap,
  analysisBusy,
  onAnalyze,
  onNavigate,
}) {
  const env = cycle?.current_assessment?.environmental_evidence;
  const screening = cycle?.current_assessment?.screening;
  const cooler = cycle?.spatial_heat?.candidates?.[0];

  return (
    <div className="hs-screen hs-map-screen">
      <div className="hs-screen-title">
        <div><span>Heat explorer</span><h1>Find the right place to work or recover</h1><p>Search a U.S. worksite or click the map. FortyGuard heat cells appear after the heat check.</p></div>
      </div>

      <form className="hs-search-bar" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="City, address, or coordinates" />
        <button type="submit" disabled={searching}>{searching ? <LoaderCircle className="spinner" size={17} /> : "Find"}</button>
      </form>
      {searchResults?.length ? (
        <div className="hs-search-results">
          {searchResults.map((item) => (
            <button key={`${item.site_id}-${item.latitude}`} type="button" onClick={() => onChooseLocation(item)}>
              <MapPinned size={16} /><span><strong>{item.name}</strong><small>{item.display_name}</small></span><ArrowRight size={15} />
            </button>
          ))}
        </div>
      ) : null}

      <SelectableHeatMap location={location} heatmapState={heatmapState} onPick={onPickMap} picking={searching} />

      <section className="hs-map-summary-grid">
        <article className="hs-map-summary hs-map-current">
          <span className="hs-summary-icon"><ThermometerSun size={22} /></span>
          <div><span>Selected worksite</span><strong>{finite(env?.temperature_c) === null ? "Awaiting heat check" : `${metric(env.temperature_c)}°C`}</strong><small>{cycle ? `${BAND_LABEL[screening?.band] ?? "Screening unavailable"} · Heat Index ${metric(env?.heat_index_c)}°C` : `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`}</small></div>
        </article>
        <article className="hs-map-summary hs-map-cooler">
          <span className="hs-summary-icon"><MapPinned size={22} /></span>
          <div><span>Nearby lower-heat candidate</span><strong>{cooler ? `${metric(cooler.temperature_c)}°C` : "Not checked yet"}</strong><small>{cooler ? `${metric(cooler.cooler_by_c)}°C cooler · ${Math.round(cooler.straight_line_distance_m)} m straight-line` : "Run a heat check to compare provider tiles."}</small></div>
        </article>
      </section>

      {!cycle ? (
        <button className="hs-primary-cta" type="button" onClick={onAnalyze} disabled={analysisBusy}>
          {analysisBusy ? <LoaderCircle className="spinner" size={19} /> : <Zap size={19} />}
          <span><strong>{analysisBusy ? "Checking this worksite…" : "Check this worksite"}</strong><small>Use the current work settings for this exact map point</small></span>
          <ArrowRight size={18} />
        </button>
      ) : (
        <button className="hs-soft-action" type="button" onClick={() => onNavigate("plan")}><SunMedium size={17} /> Review the work plan <ArrowRight size={16} /></button>
      )}
    </div>
  );
}
