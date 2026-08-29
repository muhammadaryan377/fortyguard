import { useState } from "react";
import {
  Activity,
  CalendarDays,
  Clock3,
  Flame,
  Loader2,
  MapPin,
  ShieldCheck,
} from "lucide-react";

import { fetchSiteResilience } from "../../api/decisionIntelligenceApi.js";
import "./SiteResiliencePanel.css";

function anchorDate(site) {
  const analysis = typeof site?.analysis_datetime === "string" ? site.analysis_datetime.slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(analysis)) return analysis;
  return new Date().toISOString().slice(0, 10);
}

function subtractDays(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function fToC(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(((number - 32) * 5 / 9) * 10) / 10 : 35;
}

function topTiles(layer, count = 3) {
  return [...(layer?.tiles || [])]
    .filter((tile) => Number.isFinite(Number(tile.value)))
    .sort((left, right) => Number(right.value) - Number(left.value))
    .slice(0, count);
}

function commonPeakHour(layer) {
  const counts = new Map();
  for (const tile of layer?.tiles || []) {
    const hour = Math.round(Number(tile.value));
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;
    counts.set(hour, (counts.get(hour) || 0) + 1);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0];
}

function HotspotList({ layer, suffix }) {
  const tiles = topTiles(layer);
  return (
    <div className="hs-resilience-hotspots">
      {tiles.length ? tiles.map((tile, index) => (
        <div key={tile.tile_id}>
          <span>#{index + 1}</span>
          <code>{Number(tile.centroid_latitude).toFixed(5)}, {Number(tile.centroid_longitude).toFixed(5)}</code>
          <strong>{Math.round(Number(tile.value) * 10) / 10}{suffix}</strong>
        </div>
      )) : <small>No numeric provider tiles were returned for this layer.</small>}
    </div>
  );
}

export default function SiteResiliencePanel({ site }) {
  const initialEnd = anchorDate(site);
  const [startDate, setStartDate] = useState(() => subtractDays(initialEnd, 6));
  const [endDate, setEndDate] = useState(initialEnd);
  const [thresholdF, setThresholdF] = useState(95);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function setWindow(days) {
    const end = anchorDate(site);
    setEndDate(end);
    setStartDate(subtractDays(end, days - 1));
  }

  async function run() {
    setError(null);
    setBusy(true);
    try {
      const next = await fetchSiteResilience(site, {
        startDate,
        endDate,
        thresholdC: fToC(thresholdF),
      });
      setResult(next);
    } catch (nextError) {
      setError(nextError?.message || "Historical site resilience analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  const commonPeak = commonPeakHour(result?.time_of_measure);
  const thresholdC = fToC(thresholdF);

  return (
    <section className="hs-resilience-shell">
      <div className="hs-resilience-title">
        <div>
          <span>SITE RESILIENCE · HISTORICAL FORTYGUARD</span>
          <h2>Where does this worksite repeatedly hold heat, and for how long?</h2>
          <p>Run the same site polygon through exceedance, persistence and peak-time heatmaps. HeatShield keeps the metrics separate instead of inventing a composite resilience score.</p>
        </div>
        <Flame size={26} />
      </div>

      <div className="hs-resilience-controls">
        <div className="hs-resilience-presets">
          <button type="button" onClick={() => setWindow(7)}>7 DAYS</button>
          <button type="button" onClick={() => setWindow(14)}>14 DAYS</button>
          <button type="button" onClick={() => setWindow(30)}>30 DAYS</button>
        </div>
        <label>
          <span>Start date</span>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>
          <span>End date</span>
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <label>
          <span>Heat threshold</span>
          <div className="hs-resilience-threshold"><input type="number" min="60" max="140" step="1" value={thresholdF} onChange={(event) => setThresholdF(event.target.value)} /><b>°F</b></div>
          <small>{thresholdC}°C sent to FortyGuard</small>
        </label>
        <button className="run" type="button" onClick={run} disabled={busy || !startDate || !endDate}>
          {busy ? <Loader2 className="spin" size={17} /> : <Activity size={17} />}
          {busy ? "RUNNING 3 HEATMAPS…" : "RUN SITE RESILIENCE"}
        </button>
      </div>

      {error ? <div className="hs-resilience-error">{error}</div> : null}

      {result ? (
        <>
          <div className="hs-resilience-status">
            <ShieldCheck size={16} />
            <span>{String(result.status || "unknown").replaceAll("_", " ")} · {result.start_date} → {result.end_date} · threshold {thresholdF}°F / {result.threshold_c}°C · {result.granularity} m grid</span>
          </div>

          <div className="hs-resilience-metrics">
            <article>
              <Flame size={20} />
              <span>MAX EXCEEDANCE</span>
              <strong>{result.exceedance?.maximum_value == null ? "--" : `${Math.round(result.exceedance.maximum_value * 10) / 10} h`}</strong>
              <small>Most hours above the selected threshold in any valid tile.</small>
            </article>
            <article>
              <Clock3 size={20} />
              <span>MAX PERSISTENCE</span>
              <strong>{result.persistence?.maximum_value == null ? "--" : `${Math.round(result.persistence.maximum_value * 10) / 10} h`}</strong>
              <small>Longest continuous provider run above the threshold.</small>
            </article>
            <article>
              <CalendarDays size={20} />
              <span>COMMON PEAK HOUR</span>
              <strong>{commonPeak ? `${String(commonPeak[0]).padStart(2, "0")}:00 UTC` : "--"}</strong>
              <small>{commonPeak ? `${commonPeak[1]} mapped tile${commonPeak[1] === 1 ? "" : "s"} share this peak hour.` : "Peak-time tiles unavailable."}</small>
            </article>
          </div>

          <div className="hs-resilience-layer-grid">
            <article>
              <div className="hs-resilience-layer-head"><div><span>EXCEEDANCE HOTSPOTS</span><strong>Repeated heat burden</strong></div><MapPin size={18} /></div>
              <HotspotList layer={result.exceedance} suffix=" h" />
            </article>
            <article>
              <div className="hs-resilience-layer-head"><div><span>PERSISTENCE HOTSPOTS</span><strong>Continuous hot runs</strong></div><Clock3 size={18} /></div>
              <HotspotList layer={result.persistence} suffix=" h" />
            </article>
          </div>

          <div className="hs-resilience-limitations">
            {(result.limitations || []).slice(0, 4).map((item) => <small key={item}>• {item}</small>)}
          </div>
        </>
      ) : (
        <div className="hs-resilience-empty">
          <CalendarDays size={24} />
          <div><strong>No historical scan has been run yet.</strong><span>Choose a provider-supported window up to 31 days and run the analysis only when the supervisor needs site-level resilience evidence.</span></div>
        </div>
      )}
    </section>
  );
}
