import { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { Crosshair, LoaderCircle, MapPin } from "lucide-react";

import FortyGuardHeatLayer from "./FortyGuardHeatLayer.jsx";

const selectedIcon = L.divIcon({
  className: "heatshield-marker-shell",
  html: '<div class="heatshield-map-pin"><span></span></div>',
  iconSize: [38, 46],
  iconAnchor: [19, 43],
  popupAnchor: [0, -38],
});

function Recenter({ latitude, longitude }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([latitude, longitude], Math.max(map.getZoom(), 11), { duration: 0.7 });
  }, [latitude, longitude, map]);
  return null;
}

function ClickPicker({ onPick }) {
  useMapEvents({
    click(event) {
      onPick?.(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

export default function SelectableHeatMap({
  location,
  heatmapState,
  onPick,
  picking = false,
}) {
  const markerPosition = useMemo(
    () => [location.latitude, location.longitude],
    [location.latitude, location.longitude],
  );
  const hasHeat = heatmapState?.phase === "live" && heatmapState?.mapData;

  return (
    <section className="product-map-card">
      <div className="product-map-header">
        <div>
          <span className="product-eyebrow">WORKSITE MAP</span>
          <h2>Select the exact work location</h2>
          <p>Search above or click anywhere on the map. Heat is requested only when you press Check heat & build plan.</p>
        </div>
        <div className={`product-map-state ${hasHeat ? "live" : "ready"}`}>
          {hasHeat ? <MapPin size={15} /> : <Crosshair size={15} />}
          {hasHeat ? `${heatmapState.featureCount} FortyGuard heat cells` : "Click map to choose"}
        </div>
      </div>

      <div className="product-map-stage">
        <MapContainer
          center={markerPosition}
          zoom={11}
          minZoom={3}
          maxZoom={18}
          zoomControl={false}
          scrollWheelZoom
          className="heatshield-leaflet-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Recenter latitude={location.latitude} longitude={location.longitude} />
          <ClickPicker onPick={onPick} />
          {hasHeat ? (
            <FortyGuardHeatLayer
              activityId={heatmapState.activityId}
              data={heatmapState.mapData}
              markerPosition={markerPosition}
            />
          ) : null}
          <Marker position={markerPosition} icon={selectedIcon}>
            <Tooltip
              className="map-city-tooltip"
              direction="bottom"
              offset={[0, 9]}
              opacity={1}
              permanent
            >
              <strong>{location.name}</strong>
              <span>{location.city}, {location.state}</span>
            </Tooltip>
            <Popup className="heatshield-popup">
              <strong>{location.name}</strong>
              <span>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</span>
              <span>Selected worksite</span>
            </Popup>
          </Marker>
          <ZoomControl position="bottomright" />
        </MapContainer>

        <div className="product-map-help">
          {picking ? <LoaderCircle className="spinner" size={16} /> : <Crosshair size={16} />}
          <span>{picking ? "Resolving this U.S. map point..." : "Click a map point to make it the worksite."}</span>
        </div>
      </div>
    </section>
  );
}
