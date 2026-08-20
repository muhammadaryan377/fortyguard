import {
  CheckCircle2, CloudRain, Droplets, MapPinned, ShieldCheck, SunMedium,
  Sunrise, Sunset, ThermometerSun, TimerReset, Wind, Waves,
} from "lucide-react";
import { BAND_LABEL, finite, formatWhen, metric } from "./productUtils.js";

function formatClock(value) {
  if (!value) return "--";
  const text = String(value);
  const time = text.includes("T") ? text.split("T")[1] : text;
  return time?.slice(0, 5) || "--";
}

function weatherIcon(condition, size = 18) {
  const text = String(condition || "").toLowerCase();
  if (text.includes("rain") || text.includes("drizzle")) return <CloudRain size={size} />;
  return <SunMedium size={size} />;
}

function aqiLabel(category) {
  return {
    good: "Good",
    moderate: "Moderate",
    unhealthy_for_sensitive_groups: "Sensitive groups",
    unhealthy: "Unhealthy",
    very_unhealthy: "Very unhealthy",
    hazardous: "Hazardous",
  }[category] ?? "Unavailable";
}

function riskTone(band) {
  return band ? `heat-${band}` : "heat-unavailable";
}

function WeatherHero({ cycle, weather, location }) {
  if (!cycle && !weather) return null;
  const assessment = cycle?.current_assessment;
  const env = assessment?.environmental_evidence;
  const screening = assessment?.screening;
  const current = weather?.current ?? {};
  const today = weather?.daily?.[0] ?? {};
  const primaryTemp = finite(env?.temperature_c);
  const airTemp = finite(current.temperature_2m_c);
  const displayTemp = primaryTemp ?? airTemp;
  const band = screening?.band;

  return (
    <section className={`worksite-weather-hero ${riskTone(band)}`}>
      <div className="worksite-weather-main">
        <div className="weather-location-row">
          <div><MapPinned size={17} /><span>{location?.name ?? "Selected worksite"}</span></div>
          <span className="weather-source-chip">{cycle ? "FortyGuard heat" : "Weather context preview"}</span>
        </div>
        <div className="weather-temperature-row">
          <strong>{displayTemp === null ? "--" : Math.round(displayTemp)}°</strong>
          <div>
            <h2>{cycle ? (BAND_LABEL[band] ?? "Heat screening unavailable") : (current.condition ?? "Current weather")}</h2>
            <p>{cycle ? `Heat Index ${metric(env?.heat_index_c)}°C · ${current.condition ?? "weather context"}` : "Run Heat Check for hyperlocal FortyGuard screening."}</p>
          </div>
        </div>
        <div className="weather-high-low">
          <span>Air {metric(airTemp)}°C</span>
          <span>Feels {metric(current.apparent_temperature_c)}°C</span>
          <span>High {metric(today.temperature_max_c)}°</span>
          <span>Low {metric(today.temperature_min_c)}°</span>
        </div>
      </div>
      <div className="worksite-weather-side">
        <div><span>Heat evidence</span><strong>{cycle ? "FortyGuard" : "Awaiting check"}</strong></div>
        <div><span>Weather context</span><strong>Open-Meteo</strong></div>
        <small>Secondary weather context never replaces FortyGuard heat evidence.</small>
      </div>
    </section>
  );
}

function ContextGrid({ cycle, weather }) {
  if (!weather && !cycle) return null;
  const env = cycle?.current_assessment?.environmental_evidence;
  const current = weather?.current ?? {};
  const air = weather?.air_quality ?? {};
  const today = weather?.daily?.[0] ?? {};
  const cards = [
    [ThermometerSun, "Feels like", `${metric(current.apparent_temperature_c)}°C`, "Secondary air context"],
    [Droplets, "Humidity", `${metric(env?.relative_humidity ?? current.relative_humidity_percent)}%`, cycle ? "FortyGuard preferred" : "Weather context"],
    [Wind, "Wind", `${metric(current.wind_speed_kmh)} km/h`, finite(current.wind_gusts_kmh) === null ? "Current wind" : `Gusts ${metric(current.wind_gusts_kmh)} km/h`],
    [SunMedium, "UV index", metric(air.uv_index ?? today.uv_index_max), finite(air.uv_index ?? today.uv_index_max) !== null && (air.uv_index ?? today.uv_index_max) >= 6 ? "High direct-sun context" : "Outdoor context"],
    [Waves, "Air quality", finite(air.us_aqi) === null ? "--" : Math.round(air.us_aqi), aqiLabel(air.category)],
    [CloudRain, "Rain chance", `${metric(today.precipitation_probability_max_percent, 0)}%`, "Planning context"],
  ];
  return (
    <section className="weather-context-grid">
      {cards.map(([Icon, label, value, detail]) => (
        <article key={label}><Icon size={20} /><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>
      ))}
      <article className="sun-window-card"><Sunrise size={20} /><div><span>Sunrise</span><strong>{formatClock(today.sunrise)}</strong><small>Direct-sun planning</small></div></article>
      <article className="sun-window-card"><Sunset size={20} /><div><span>Sunset</span><strong>{formatClock(today.sunset)}</strong><small>Direct-sun planning</small></div></article>
    </section>
  );
}

function HourlyWorkTimeline({ cycle, weather }) {
  const hourly = weather?.hourly ?? [];
  const samples = cycle?.heat_outlook?.points ?? [];
  if (!hourly.length) return null;
  return (
    <section className="hourly-work-panel">
      <div className="product-section-title compact-title">
        <div><span className="product-eyebrow">NEXT HOURS</span><h2>Worksite weather timeline</h2><p>Air-weather context with provider heat samples highlighted when available.</p></div>
        <TimerReset size={22} />
      </div>
      <div className="hourly-work-strip">
        {hourly.slice(0, 7).map((hour, index) => {
          const providerSample = samples.find((sample) => sample.offset_hours === index && sample.status === "available");
          return (
            <article key={`${hour.local_time}-${index}`} className={providerSample ? "provider-sampled-hour" : ""}>
              <span>{index === 0 ? "Now" : formatClock(hour.local_time)}</span>
              {weatherIcon(hour.condition, 20)}
              <strong>{metric(hour.temperature_2m_c)}°</strong>
              <small>Feels {metric(hour.apparent_temperature_c)}°</small>
              <small>UV {metric(hour.uv_index)}</small>
              {providerSample ? <b>FG {metric(providerSample.temperature_c)}°C</b> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function WorksiteGuidance({ cycle, weather, work }) {
  if (!cycle && !weather) return null;
  const env = cycle?.current_assessment?.environmental_evidence;
  const cooler = cycle?.spatial_heat?.candidates?.[0];
  const samples = (cycle?.heat_outlook?.points ?? []).filter((point) => point.status === "available" && finite(point.temperature_c) !== null);
  const coolest = samples.length ? [...samples].sort((a, b) => a.temperature_c - b.temperature_c)[0] : null;
  const current = weather?.current ?? {};
  const air = weather?.air_quality ?? {};
  const uv = finite(air.uv_index ?? weather?.daily?.[0]?.uv_index_max);
  const rain = finite(weather?.daily?.[0]?.precipitation_probability_max_percent);
  const guidance = [];

  if (work?.directSun && uv !== null) {
    guidance.push({ icon: SunMedium, title: uv >= 6 ? "Direct sun needs attention" : "Direct sun context", value: `UV ${metric(uv)}`, detail: uv >= 6 ? "Keep shade / direct-sun controls prominent in the work plan." : "Current UV context is available for task positioning." });
  }
  if (cooler) {
    guidance.push({ icon: MapPinned, title: "Nearby lower-heat option", value: `${metric(cooler.cooler_by_c)}°C cooler`, detail: `${Math.round(cooler.straight_line_distance_m)} m straight-line. Verify access and hazards first.` });
  }
  if (coolest && finite(env?.temperature_c) !== null && coolest.temperature_c < env.temperature_c) {
    guidance.push({ icon: TimerReset, title: "Lower-heat sampled time", value: `${metric(coolest.temperature_c)}°C`, detail: `${formatWhen(coolest.requested_local_timestamp)} · comparative sample, not a safe-time guarantee.` });
  }
  if (finite(air.us_aqi) !== null) {
    guidance.push({ icon: Waves, title: "Outdoor air context", value: `AQI ${Math.round(air.us_aqi)}`, detail: air.us_aqi >= 101 ? `${aqiLabel(air.category)} adds an outdoor exposure concern; follow site policy.` : `${aqiLabel(air.category)} air-quality context.` });
  }
  if (finite(current.wind_gusts_kmh) !== null && current.wind_gusts_kmh >= 30) {
    guidance.push({ icon: Wind, title: "Gusty field conditions", value: `${metric(current.wind_gusts_kmh)} km/h gusts`, detail: "Check temporary shade, barriers and field setup before use." });
  } else if (rain !== null && rain >= 40) {
    guidance.push({ icon: CloudRain, title: "Rain may affect operations", value: `${metric(rain, 0)}% max chance`, detail: "Use this as planning context for outdoor task sequencing." });
  }

  return (
    <section className="worksite-guidance-panel">
      <div className="product-section-title compact-title">
        <div><span className="product-eyebrow">WORKSITE GUIDANCE</span><h2>What matters for this job</h2><p>Only context that can change an outdoor-work decision is shown here.</p></div>
        <ShieldCheck size={22} />
      </div>
      <div className="worksite-guidance-grid">
        {guidance.slice(0, 4).map(({ icon: Icon, title, value, detail }) => (
          <article key={title}><Icon size={21} /><div><span>{title}</span><strong>{value}</strong><p>{detail}</p></div></article>
        ))}
        {!guidance.length ? <article className="guidance-empty"><CheckCircle2 size={21} /><div><strong>No additional operational context flagged</strong><p>Run the Heat Check to build the provider-backed plan.</p></div></article> : null}
      </div>
    </section>
  );
}

export default function ProductWeather({ cycle, weather, work, location }) {
  if (!cycle && !weather) return null;
  return (
    <div className="product-weather-stack">
      <WeatherHero cycle={cycle} weather={weather} location={location} />
      <ContextGrid cycle={cycle} weather={weather} />
      <HourlyWorkTimeline cycle={cycle} weather={weather} />
      <WorksiteGuidance cycle={cycle} weather={weather} work={work} />
    </div>
  );
}
