import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";

import { loadCrewMap, polygonCenter } from "./planWorkspace.js";
import "./DecisionTwinMap.css";

const ZONE_STYLE = {
  work: { color: "#f97316", fillColor: "#fb923c", fillOpacity: 0.08, weight: 2 },
  recovery: { color: "#16a34a", fillColor: "#4ade80", fillOpacity: 0.1, weight: 2 },
  restricted: { color: "#dc2626", fillColor: "#f87171", fillOpacity: 0.07, weight: 2, dashArray: "6 5" },
  transit: { color: "#64748b", fillColor: "#94a3b8", fillOpacity: 0.04, weight: 1.5, dashArray: "6 5" },
};

function TwinViewport({ site }) {
  const map = useMap();
  useEffect(() => {
    const points = site?.polygon ?? [];
    if (points.length >= 3) {
      map.fitBounds(points.map((point) => [point.latitude, point.longitude]), { padding: [32, 32] });
    } else {
      map.setView(polygonCenter(site), 17);
    }
  }, [map, site]);
  return null;
}

function relativeTileStyle(temperature, minimum, maximum) {
  const value = Number(temperature);
  const low = Number(minimum);
  const high = Number(maximum);
  const ratio = Number.isFinite(value) && Number.isFinite(low) && Number.isFinite(high) && high > low
    ? Math.max(0, Math.min(1, (value - low) / (high - low)))
    : 0.5;
  const hue = 205 - ratio * 190;
  return {
    color: `hsl(${hue} 72% 42%)`,
    fillColor: `hsl(${hue} 78% 50%)`,
    fillOpacity: 0.25,
    weight: 1.1,
  };
}

export default function DecisionTwinMap({
  site,
  crew = [],
  worker,
  spatial,
  selectedCandidateId,
  onSelectCandidate,
}) {
  const sitePositions = (site?.polygon || []).map((point) => [point.latitude, point.longitude]);
  const zones = site?.zones || [];
  const tiles = spatial?.tiles || [];
  const candidates = spatial?.candidates || [];
  const storedCrew = site?.id ? (loadCrewMap()[site.id] || []) : [];
  const visibleCrew = crew.length ? crew : storedCrew.length ? storedCrew : worker ? [worker] : [];
  const temperatures = tiles.map((tile) => Number(tile.temperature_c)).filter(Number.isFinite);
  const minimum = temperatures.length ? Math.min(...temperatures) : null;
  const maximum = temperatures.length ? Math.max(...temperatures) : null;

  return (
    <section className="hs-twin-shell">
      <div className="hs-twin-heading">
        <div>
          <span>LIVE OPERATIONAL DIGITAL TWIN</span>
          <h3>Master site + operational zones + crew + FortyGuard thermal tiles</h3>
        </div>
        <small>Thermal colors are relative to this provider scan, not safety bands. Zone outlines come from supervisor setup.</small>
      </div>
      <div className="hs-twin-map-wrap">
        <MapContainer center={polygonCenter(site)} zoom={17} scrollWheelZoom className="hs-twin-map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <TwinViewport site={site} />

          {tiles.map((tile) => {
            const ring = tile?.polygon_coordinates?.[0] || [];
            if (ring.length < 4) return null;
            return (
              <Polygon
                key={tile.tile_id}
                positions={ring.map((point) => [point[1], point[0]])}
                pathOptions={relativeTileStyle(tile.temperature_c, minimum, maximum)}
              >
                <Tooltip>
                  {Number.isFinite(Number(tile.temperature_c)) ? `${Number(tile.temperature_c).toFixed(1)}°C` : "temperature unavailable"}
                  {tile.contains_site ? " · selected worker tile" : ""}
                </Tooltip>
              </Polygon>
            );
          })}

          {zones.map((zone) => {
            const positions = (zone.polygon || []).map((point) => [point.latitude, point.longitude]);
            if (positions.length < 3) return null;
            const base = ZONE_STYLE[zone.type] || ZONE_STYLE.transit;
            return (
              <Polygon
                key={`zone-${zone.id}`}
                positions={positions}
                pathOptions={{ ...base, opacity: zone.active ? 1 : 0.35, fillOpacity: zone.active ? base.fillOpacity : 0.02 }}
              >
                <Tooltip sticky>{zone.name} · {zone.type}{zone.relocationAllowed ? " · alternative enabled" : ""}</Tooltip>
              </Polygon>
            );
          })}

          {sitePositions.length >= 3 ? (
            <Polygon positions={sitePositions} pathOptions={{ color: "#2563eb", weight: 3, fillOpacity: 0.01 }}>
              <Tooltip sticky>Master site boundary</Tooltip>
            </Polygon>
          ) : null}

          {visibleCrew.map((member) => {
            if (!member?.position) return null;
            const selected = member.workerId === worker?.workerId;
            return (
              <CircleMarker
                key={member.workerId}
                center={[member.position.latitude, member.position.longitude]}
                radius={selected ? 10 : 7}
                pathOptions={{
                  color: selected ? "#0f172a" : "#475569",
                  fillColor: selected ? "#ffffff" : "#cbd5e1",
                  fillOpacity: 1,
                  weight: selected ? 4 : 2,
                }}
              >
                <Tooltip permanent={selected} direction="top" offset={[0, -10]}>
                  {member.name || member.workerId}{selected ? " · selected" : ""}
                </Tooltip>
              </CircleMarker>
            );
          })}

          {candidates.map((candidate) => {
            const selected = candidate.candidate_id === selectedCandidateId;
            return (
              <CircleMarker
                key={candidate.candidate_id}
                center={[candidate.centroid_latitude, candidate.centroid_longitude]}
                radius={selected ? 11 : 8}
                pathOptions={{
                  color: selected ? "#075985" : "#0f766e",
                  fillColor: selected ? "#38bdf8" : "#5eead4",
                  fillOpacity: 0.95,
                  weight: selected ? 4 : 3,
                }}
                eventHandlers={{ click: () => onSelectCandidate?.(candidate.candidate_id) }}
              >
                <Tooltip direction="top" permanent={selected}>
                  #{candidate.rank} · {Number(candidate.temperature_c).toFixed(1)}°C · {Math.round(candidate.straight_line_distance_m)} m
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
      <div className="hs-twin-legend hs-twin-legend-zones">
        <span><i className="worker" />Selected worker</span>
        <span><i className="crew" />Other crew</span>
        <span><i className="candidate" />Cooler candidate</span>
        <span><i className="zone-work" />Work zone</span>
        <span><i className="zone-recovery" />Recovery zone</span>
        <span><i className="zone-restricted" />Restricted</span>
        <span><i className="boundary" />Master boundary</span>
        <strong>{minimum === null || maximum === null ? "Thermal layer pending" : `${minimum.toFixed(1)}–${maximum.toFixed(1)}°C mapped range`}</strong>
      </div>
    </section>
  );
}
