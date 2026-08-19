import L from "leaflet";
import { AlertTriangle, ChevronDown, Info, Layers3, LoaderCircle } from "lucide-react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
} from "react-leaflet";
import FortyGuardHeatLayer from "./FortyGuardHeatLayer.jsx";
import MockHeatLayer from "./MockHeatLayer.jsx";

const PHOENIX = [33.4484, -112.074];

const locationIcon = L.divIcon({
  className: "heatshield-marker-shell",
  html: '<div class="heatshield-map-pin"><span></span></div>',
  iconSize: [38, 46],
  iconAnchor: [19, 43],
  popupAnchor: [0, -38],
});

const defaultHeatmapState = {
  phase: "demo",
  activityId: null,
  providerStatus: null,
  mapData: null,
  featureCount: 0,
  request: null,
  error: null,
};

export default function LiveHeatMap({ heatmapState = defaultHeatmapState }) {
  const isLive = heatmapState.phase === "live" && heatmapState.mapData;
  const isLoading = heatmapState.phase === "loading";
  const showMock = heatmapState.phase === "demo" || heatmapState.phase === "error";
  const dateTime = heatmapState.request?.date_time;

  return (
    <section className="panel map-panel">
      <div className="map-card-header">
        <div className="map-title">
          <h2>Live Heat Map</h2>
          <Info size={16} aria-label="Interactive surface-temperature heat map" />
          <span
            className={`map-data-badge ${isLive ? "provider-live" : isLoading ? "provider-loading" : "provider-demo"}`}
          >
            <i />
            {isLive ? "FortyGuard Live" : isLoading ? "Analyzing" : "Demo Data"}
          </span>
        </div>
        <button className="map-layer-select" type="button" aria-label="Select heat map layer">
          <Layers3 size={16} />
          Surface Temperature
          <ChevronDown size={15} />
        </button>
      </div>

      <div className="map-stage">
        <MapContainer
          center={PHOENIX}
          zoom={11}
          minZoom={9}
          maxZoom={18}
          zoomControl={false}
          scrollWheelZoom
          className="heatshield-leaflet-map"
        >
          <TileLayer
            className="osm-dark-tiles"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {isLive ? (
            <FortyGuardHeatLayer
              activityId={heatmapState.activityId}
              data={heatmapState.mapData}
              markerPosition={PHOENIX}
            />
          ) : null}
          {showMock ? <MockHeatLayer /> : null}

          <Marker position={PHOENIX} icon={locationIcon} keyboard>
            <Tooltip
              className="map-city-tooltip"
              direction="bottom"
              offset={[0, 9]}
              opacity={1}
              permanent
            >
              <strong>Phoenix</strong>
              <span>Central City</span>
            </Tooltip>
            <Popup className="heatshield-popup">
              <strong>Phoenix Central City</strong>
              <span>33.4484, -112.0740</span>
              <span>
                {isLive
                  ? "FortyGuard heat geometry loaded — select a tile for provider values."
                  : "Selected demonstration location"}
              </span>
            </Popup>
          </Marker>

          <Pane name="map-points-of-interest" style={{ zIndex: 560 }}>
            <CircleMarker
              center={[33.4725, -112.0877]}
              radius={7}
              pathOptions={{ color: "#65e684", fillColor: "#173f34", fillOpacity: 1, weight: 2 }}
            >
              <Popup className="heatshield-popup">
                <strong>Encanto Park</strong>
                <span>Lower-heat green space</span>
              </Popup>
            </CircleMarker>
          </Pane>

          <ZoomControl position="bottomright" />
        </MapContainer>

        <div className="map-request-status" aria-live="polite">
          {isLoading ? (
            <div className="map-status-card status-loading">
              <LoaderCircle className="map-status-spinner" size={16} aria-hidden="true" />
              <span>
                <strong>Analyzing heat conditions...</strong>
                Waiting for the FortyGuard job to complete
              </span>
            </div>
          ) : null}

          {heatmapState.phase === "error" ? (
            <div className="map-status-card status-error" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>
                <strong>Unable to load live heat intelligence.</strong>
                {heatmapState.error}
              </span>
            </div>
          ) : null}

          {isLive ? (
            <div className="map-status-card status-live">
              <span className="status-dot" aria-hidden="true" />
              <span>
                <strong>
                  Provider snapshot · {heatmapState.featureCount} heat polygon
                  {heatmapState.featureCount === 1 ? "" : "s"}
                </strong>
                {dateTime?.start_date} at {dateTime?.start_time} · activity {heatmapState.activityId}
              </span>
            </div>
          ) : null}
        </div>

        <div className="map-legend" aria-label="Heat intensity legend">
          <span>Lower Heat</span>
          <div className="heat-gradient" />
          <span>Extreme Heat</span>
        </div>
      </div>
    </section>
  );
}
