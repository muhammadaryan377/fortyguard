import { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { Crosshair, LoaderCircle, MapPin, ShieldAlert } from "lucide-react";

import FortyGuardHeatLayer from "./FortyGuardHeatLayer.jsx";

const selectedIcon = L.divIcon({
  className: "heatshield-marker-shell",
  html: '<div class="heatshield-map-pin"><span></span></div>',
  iconSize: [38, 46],
  iconAnchor: [19, 43],
  popupAnchor: [0, -38],
});

const candidateIcon = L.divIcon({
  className: "heatshield-marker-shell",
  html: '<div class="heatshield-candidate-pin"><span></span></div>',
  iconSize: [36, 42],
  iconAnchor: [18, 39],
  popupAnchor: [0, -35],
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
  fortyGuardSupported = false,
  heatmapState,
  spatialCandidates = [],
  onPick,
  picking = false,
}) {
  const markerPosition = useMemo(
    () => [location.latitude, location.longitude],
    [location.latitude, location.longitude],
  );
  const hasHeat = heatmapState?.phase === "live" && heatmapState?.mapData;
  const visibleCandidates = (spatialCandidates ?? []).slice(0, 3);
  const bestCandidate = visibleCandidates[0];
  const placeLine = [location.city, location.state, location.country].filter(Boolean).join(", ");

  return (
    <section className="product-map-card hs-v6-map-card">
      <div className="product-map-header">
        <div>
          <span className="product-eyebrow">HEAT MAP</span>
          <h2>Select the exact place you want to check</h2>
          <p>Tap anywhere on the map. General weather works globally; FortyGuard heat cells and lower-heat candidates appear for supported U.S. worksites after a scan.</p>
        </div>
        <div className={`product-map-state ${hasHeat ? "live" : fortyGuardSupported ? "ready" : "unsupported"}`}>
          {hasHeat ? <MapPin size={15} /> : fortyGuardSupported ? <Crosshair size={15} /> : <ShieldAlert size={15} />}
          {hasHeat ? `${heatmapState.featureCount} FortyGuard cells` : fortyGuardSupported ? "Ready for FortyGuard" : "Weather context"}
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

          {bestCandidate ? (
            <Polyline
              positions={[
                markerPosition,
                [bestCandidate.centroid_latitude, bestCandidate.centroid_longitude],
              ]}
              pathOptions={{ color: "#ffffff", weight: 3, opacity: 0.95, dashArray: "8 9" }}
            />
          ) : null}

          {visibleCandidates.map((candidate, index) => (
            <Marker
              key={candidate.candidate_id || `${candidate.centroid_latitude}-${candidate.centroid_longitude}`}
              position={[candidate.centroid_latitude, candidate.centroid_longitude]}
              icon={candidateIcon}
            >
              <Tooltip className="map-candidate-tooltip" direction="top" offset={[0, -31]} opacity={1}>
                <strong>{index === 0 ? "Best lower-heat candidate" : `Lower-heat candidate ${index + 1}`}</strong>
                <span>{candidate.cooler_by_c?.toFixed?.(1) ?? candidate.cooler_by_c}°C lower · {Math.round(candidate.straight_line_distance_m)} m</span>
              </Tooltip>
              <Popup className="heatshield-popup">
                <strong>Comparatively lower-heat tile</strong>
                <span>{candidate.temperature_c?.toFixed?.(1) ?? candidate.temperature_c}°C mapped temperature</span>
                <span>{candidate.cooler_by_c?.toFixed?.(1) ?? candidate.cooler_by_c}°C lower than selected tile</span>
                <span>Not a safety or accessibility determination.</span>
              </Popup>
            </Marker>
          ))}

          <Marker position={markerPosition} icon={selectedIcon}>
            <Tooltip
              className="map-city-tooltip"
              direction="bottom"
              offset={[0, 9]}
              opacity={1}
              permanent
            >
              <strong>{location.name}</strong>
              <span>{placeLine}</span>
            </Tooltip>
            <Popup className="heatshield-popup">
              <strong>{location.name}</strong>
              <span>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</span>
              <span>{fortyGuardSupported ? "FortyGuard-supported worksite" : "Weather-context location"}</span>
            </Popup>
          </Marker>
          <ZoomControl position="bottomright" />
        </MapContainer>

        <div className="product-map-help">
          {picking ? <LoaderCircle className="spinner" size={16} /> : <Crosshair size={16} />}
          <span>{picking ? "Resolving this map point..." : "Tap the map to select this exact point."}</span>
        </div>

        {!fortyGuardSupported ? (
          <div className="hs-map-coverage-overlay">
            <ShieldAlert size={16} />
            <span>FortyGuard heat intelligence is not available at this selected location.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
