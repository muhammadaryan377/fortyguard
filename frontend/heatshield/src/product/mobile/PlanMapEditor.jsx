import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

import { polygonCenter } from "./planWorkspace.js";

const ZONE_STYLE = {
  work: { color: "#f97316", fillColor: "#fb923c", fillOpacity: 0.18, weight: 3 },
  recovery: { color: "#16a34a", fillColor: "#4ade80", fillOpacity: 0.2, weight: 3 },
  restricted: { color: "#dc2626", fillColor: "#f87171", fillOpacity: 0.14, weight: 3, dashArray: "7 5" },
  transit: { color: "#64748b", fillColor: "#94a3b8", fillOpacity: 0.1, weight: 2, dashArray: "6 5" },
};

function MapViewport({ site }) {
  const map = useMap();
  useEffect(() => {
    const points = site?.polygon ?? [];
    if (points.length >= 3) {
      map.fitBounds(points.map((point) => [point.latitude, point.longitude]), { padding: [24, 24] });
    } else {
      map.setView(polygonCenter(site), 17);
    }
  }, [map, site]);
  return null;
}

function MapClickHandler({ enabled, onClick }) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      onClick?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

export default function PlanMapEditor({
  site,
  crew = [],
  mode = "idle",
  activeWorkerId = null,
  activeZoneId = null,
  onMapClick,
  height = 330,
}) {
  const center = polygonCenter(site);
  const polygonPositions = (site?.polygon ?? []).map((point) => [point.latitude, point.longitude]);
  const zones = site?.zones || [];
  const activeZone = zones.find((zone) => zone.id === activeZoneId) || null;
  const activeZonePositions = (activeZone?.polygon || []).map((point) => [point.latitude, point.longitude]);
  const activeWorker = crew.find((worker) => worker.workerId === activeWorkerId) ?? null;

  return (
    <div className={`hs-advanced-map mode-${mode}`}>
      <MapContainer
        center={center}
        zoom={17}
        scrollWheelZoom
        className="hs-advanced-leaflet"
        style={{ height }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapViewport site={site} />
        <MapClickHandler enabled={["draw", "zone", "worker"].includes(mode)} onClick={onMapClick} />

        {polygonPositions.length >= 3 ? (
          <Polygon positions={polygonPositions} pathOptions={{ color: "#2563eb", fillColor: "#60a5fa", weight: 3, fillOpacity: 0.055 }}>
            <Tooltip sticky>Master site boundary</Tooltip>
          </Polygon>
        ) : null}

        {zones.map((zone) => {
          const positions = (zone.polygon || []).map((point) => [point.latitude, point.longitude]);
          if (positions.length < 3) return null;
          const base = ZONE_STYLE[zone.type] || ZONE_STYLE.transit;
          return (
            <Polygon
              key={zone.id}
              positions={positions}
              pathOptions={{ ...base, opacity: zone.active ? 1 : 0.42, fillOpacity: zone.active ? base.fillOpacity : 0.04 }}
            >
              <Tooltip sticky>{zone.name} · {zone.type}{zone.active ? "" : " · inactive"}</Tooltip>
            </Polygon>
          );
        })}

        {mode === "draw" ? polygonPositions.map((position, index) => (
          <CircleMarker key={`vertex-${index}`} center={position} radius={5} pathOptions={{ color: "#2563eb", weight: 2 }}>
            <Tooltip direction="top">Boundary {index + 1}</Tooltip>
          </CircleMarker>
        )) : null}

        {mode === "zone" ? activeZonePositions.map((position, index) => (
          <CircleMarker key={`zone-vertex-${index}`} center={position} radius={5} pathOptions={{ color: ZONE_STYLE[activeZone?.type]?.color || "#f97316", weight: 2 }}>
            <Tooltip direction="top">{activeZone?.name || "Zone"} point {index + 1}</Tooltip>
          </CircleMarker>
        )) : null}

        {crew.map((worker, index) => worker.position ? (
          <CircleMarker
            key={worker.workerId}
            center={[worker.position.latitude, worker.position.longitude]}
            radius={activeWorkerId === worker.workerId ? 10 : 8}
            pathOptions={{ color: activeWorkerId === worker.workerId ? "#0f172a" : "#2563eb", weight: activeWorkerId === worker.workerId ? 4 : 2 }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]}>
              {index + 1} · {worker.name || worker.workerId}
            </Tooltip>
          </CircleMarker>
        ) : null)}
      </MapContainer>
      <div className="hs-advanced-map-status">
        {mode === "draw" ? "Master boundary mode: tap around the outside edge of the full property/site." : null}
        {mode === "zone" ? `Zone drawing: tap inside the master boundary to define ${activeZone?.name || "the selected operational zone"}.` : null}
        {mode === "worker" ? `Worker placement: tap inside ${activeWorker?.zoneLabel || "the assigned work zone"} to place ${activeWorker?.name || activeWorkerId || "the selected worker"}.` : null}
        {mode === "idle" && crew.length ? `${polygonPositions.length >= 3 ? "Master site locked" : "Site boundary incomplete"} · ${zones.filter((zone) => zone.active && zone.polygon?.length >= 3).length} active zones · ${crew.filter((worker) => worker.position).length}/${crew.length} worker positions.` : null}
        {mode === "idle" && !crew.length ? (polygonPositions.length >= 3 ? `${zones.filter((zone) => zone.active && zone.polygon?.length >= 3).length} operational zones inside the master site.` : "Draw the master site boundary first.") : null}
      </div>
    </div>
  );
}
