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

function MapViewport({ site }) {
  const map = useMap();
  useEffect(() => {
    const points = site?.polygon ?? [];
    if (points.length >= 3) {
      map.fitBounds(points.map((point) => [point.latitude, point.longitude]), { padding: [24, 24] });
    } else {
      map.setView(polygonCenter(site), 17);
    }
  }, [map, site?.id, site?.polygon]);
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
  onMapClick,
  height = 330,
}) {
  const center = polygonCenter(site);
  const polygonPositions = (site?.polygon ?? []).map((point) => [point.latitude, point.longitude]);
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
        <MapClickHandler enabled={mode === "draw" || mode === "worker"} onClick={onMapClick} />
        {polygonPositions.length >= 3 ? (
          <Polygon positions={polygonPositions} pathOptions={{ weight: 3, fillOpacity: 0.12 }} />
        ) : null}
        {polygonPositions.map((position, index) => (
          <CircleMarker key={`vertex-${index}`} center={position} radius={5} pathOptions={{ weight: 2 }}>
            <Tooltip direction="top">Boundary {index + 1}</Tooltip>
          </CircleMarker>
        ))}
        {crew.map((worker, index) => worker.position ? (
          <CircleMarker
            key={worker.workerId}
            center={[worker.position.latitude, worker.position.longitude]}
            radius={activeWorkerId === worker.workerId ? 10 : 8}
            pathOptions={{ weight: activeWorkerId === worker.workerId ? 4 : 2 }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]}>
              {index + 1} · {worker.name || worker.workerId}
            </Tooltip>
          </CircleMarker>
        ) : null)}
      </MapContainer>
      <div className="hs-advanced-map-status">
        {mode === "draw" ? "Boundary mode: tap around the outside edge of the full operational site." : null}
        {mode === "worker" ? `Worker placement: tap inside the site boundary to place ${activeWorker?.name || activeWorkerId || "the selected worker"}.` : null}
        {mode === "idle" ? `${polygonPositions.length >= 3 ? "Site boundary locked" : "Site boundary incomplete"} · ${crew.filter((worker) => worker.position).length}/${crew.length} worker positions recorded.` : null}
      </div>
    </div>
  );
}
