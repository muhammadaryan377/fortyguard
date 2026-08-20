import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Droplets,
  MapPinned,
  SunMedium,
  Sunrise,
  Sunset,
  Users,
  Wind,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { BAND_LABEL, finite } from "../productUtils.js";

function cToF(value) {
  const parsed = finite(value);
  return parsed === null ? null : (parsed * 9) / 5 + 32;
}

function kmhToMph(value) {
  const parsed = finite(value);
  return parsed === null ? null : parsed * 0.621371;
}

function rounded(value) {
  return finite(value) === null ? "--" : Math.round(Number(value));
}

function timeParts(value) {
  if (!value) return null;
  const text = String(value);
  const time = text.includes("T") ? text.split("T")[1] : text;
  const [hourText, minuteText = "00"] = (time || "").split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return null;
  return { hour, minute: Number(minuteText) || 0 };
}

function formatTime(value, includeMinutes = true) {
  const parts = timeParts(value);
  if (!parts) return "--";
  const period = parts.hour >= 12 ? "PM" : "AM";
  const hour12 = parts.hour % 12 || 12;
  if (!includeMinutes || parts.minute === 0) return `${hour12} ${period}`;
  return `${hour12}:${String(parts.minute).padStart(2, "0")} ${period}`;
}

function peakWindowLabel(hourly) {
  const usable = (hourly ?? [])
    .slice(0, 10)
    .map((item, index) => ({ index, item, temp: finite(item.temperature_2m_c) }))
    .filter((item) => item.temp !== null);

  if (!usable.length) return "Peak window loading";
  const peak = usable.reduce((best, item) => (item.temp > best.temp ? item : best), usable[0]);
  const source = (hourly ?? []).slice(0, 10);
  const start = source[Math.max(0, peak.index - 1)];
  const end = source[Math.min(source.length - 1, peak.index + 2)];
  const startText = formatTime(start?.local_time, false);
  const endText = formatTime(end?.local_time, false);
  return startText === endText ? `Peak heat around ${startText}` : `Peak heat expected ${startText}–${endText}`;
}

function attentionCount(work, cycle) {
  let count = 0;
  if (!work?.acclimatized) count += 1;
  if (["heavy", "very_heavy"].includes(work?.workload)) count += 1;
  if (
    work?.directSun &&
    cycle?.current_assessment?.screening?.band &&
    cycle.current_assessment.screening.band !== "below_caution"
  ) {
    count += 1;
  }
  return count;
}

function riskClass(band) {
  if (["danger", "extreme_danger"].includes(band)) return "is-danger";
  if (["caution", "extreme_caution"].includes(band)) return "is-caution";
  if (band === "below_caution") return "is-lower";
  return "is-awaiting";
}

function TimelineCard({ weather }) {
  const hourly = (weather?.hourly ?? []).slice(0, 7);
  const chartData = hourly
    .map((item, index) => ({
      label: index === 0 ? "Now" : formatTime(item.local_time, false),
      temp: cToF(item.temperature_2m_c),
    }))
    .filter((item) => item.temp !== null);

  return (
    <article className="hs-feature-card hs-timeline-card">
      <div className="hs-timeline-heading">Today’s heat timeline</div>
      <div className="hs-mini-chart">
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="hsTodayHeatGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff7043" stopOpacity={0.34} />
                  <stop offset="100%" stopColor="#ffb55f" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                tick={{ fontSize: 10, fill: "#405970" }}
              />
              <Tooltip formatter={(value) => [`${Math.round(Number(value))}°F`, "Air temperature"]} />
              <Area
                dataKey="temp"
                type="monotone"
                stroke="#ff6b35"
                strokeWidth={2.6}
                fill="url(#hsTodayHeatGradient)"
                dot={{ r: 4, strokeWidth: 2, stroke: "#ffffff", fill: "#ff8a30" }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff", fill: "#ef4c38" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="hs-empty-mini">Hourly weather will appear when available.</div>
        )}
      </div>
      <div className="hs-timeline-legend" aria-label="Heat timeline legend">
        <span><i className="lower" />Lower</span>
        <span><i className="caution" />Caution</span>
        <span><i className="extreme" />Higher heat</span>
      </div>
    </article>
  );
}

export default function TodayScreen({
  cycle,
  weather,
  work,
  onNavigate,
}) {
  const env = cycle?.current_assessment?.environmental_evidence;
  const screening = cycle?.current_assessment?.screening;
  const currentWeather = weather?.current ?? {};
  const today = weather?.daily?.[0] ?? {};
  const band = screening?.band;

  const airTempF = cToF(currentWeather.temperature_2m_c);
  const feelsLikeF = cToF(currentWeather.apparent_temperature_c);
  const heatIndexF = cToF(env?.heat_index_c);
  const humidity = finite(currentWeather.relative_humidity_percent ?? env?.relative_humidity);
  const windMph = kmhToMph(currentWeather.wind_speed_kmh);
  const cooler = cycle?.spatial_heat?.candidates?.[0];
  const attention = attentionCount(work, cycle);
  const workerAttention = attention > 0 ? 1 : 0;
  const bandLabel = BAND_LABEL[band] ?? "Heat check needed";
  const coolerMiles = cooler ? cooler.straight_line_distance_m / 1609.344 : null;

  return (
    <div className="hs-screen hs-today-screen">
      <section className="hs-hero-card">
        <div className="hs-hero-main">
          <div className="hs-big-temp" title="Open-Meteo air temperature at 2 m">
            <strong>{rounded(airTempF)}<sup>°F</sup></strong>
            <span>Feels like {rounded(feelsLikeF)}°</span>
          </div>

          <div className={`hs-risk-pill ${riskClass(band)}`}>
            <AlertTriangle size={30} strokeWidth={2.4} />
            <div>
              <strong>{bandLabel}</strong>
              <span>{cycle ? `Heat index: ${rounded(heatIndexF)}°F` : "Run the worksite heat check"}</span>
            </div>
          </div>
        </div>

        <div className="hs-peak-line">
          <SunMedium size={27} />
          <strong>{peakWindowLabel(weather?.hourly)}</strong>
        </div>

        <div className="hs-hero-stats">
          <div><Droplets size={25} /><strong>{rounded(humidity)}%</strong><span>Humidity</span></div>
          <div><Wind size={25} /><strong>{rounded(windMph)} mph</strong><span>Wind</span></div>
          <div><Sunrise size={25} /><strong>{formatTime(today.sunrise)}</strong><span>Sunrise</span></div>
          <div><Sunset size={25} /><strong>{formatTime(today.sunset)}</strong><span>Sunset</span></div>
        </div>
      </section>

      <section className="hs-feature-grid">
        <button className="hs-feature-card hs-feature-blue" type="button" onClick={() => onNavigate("plan")}>
          <span className="hs-feature-icon"><ClipboardList size={26} /></span>
          <div className="hs-feature-body">
            <strong>Build safer shift plan</strong>
            <p>{cycle ? `${cycle.agent_decision?.actions?.length ?? 0} recommended controls are ready to review.` : "Create a heat-aware schedule with workload, timing and recovery controls."}</p>
            <b>{cycle ? "Review plan" : "Create plan"} <ArrowRight size={15} /></b>
          </div>
        </button>

        <button className="hs-feature-card hs-feature-green" type="button" onClick={() => onNavigate("map")}>
          <span className="hs-feature-icon"><MapPinned size={26} /></span>
          <div className="hs-feature-body">
            <strong>Nearby cooler recovery area</strong>
            <p>{cooler ? `Lower-heat candidate about ${coolerMiles.toFixed(1)} miles away.` : "Run a heat check to compare nearby FortyGuard heat cells."}</p>
            <b>View on map <ArrowRight size={15} /></b>
          </div>
        </button>

        <button className="hs-feature-card hs-feature-warm" type="button" onClick={() => onNavigate("team")}>
          <span className="hs-feature-icon"><Users size={26} /></span>
          <div className="hs-feature-body">
            <strong>Workers needing attention</strong>
            <div className="hs-worker-count"><em>{workerAttention}</em><span>worker{workerAttention === 1 ? "" : "s"}</span></div>
            <p>{attention ? `${attention} current work factor${attention === 1 ? "" : "s"} deserve extra review.` : "No additional worker attention flags yet."}</p>
            <b>View worker <ArrowRight size={15} /></b>
          </div>
        </button>

        <TimelineCard weather={weather} />
      </section>
    </div>
  );
}
