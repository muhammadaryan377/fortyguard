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

function MapClickHandler({ onClick }) {
  useMapEvents({
    click(event) {
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
        <MapClickHandler onClick={onMapClick} />
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
            <Tooltip permanent direction="top" offset={[0, -8]}>{index + 1}</Tooltip>
          </CircleMarker>
        ) : null)}
      </MapContainer>
      <div className="hs-advanced-map-status">
        {mode === "draw" ? "Tap around the outside of the full site boundary." : null}
        {mode === "worker" ? "Tap inside the boundary to place the selected worker." : null}
        {mode === "idle" ? "The site polygon and worker points are used as planning inputs." : null}
      </div>
    </div>
  );
}
