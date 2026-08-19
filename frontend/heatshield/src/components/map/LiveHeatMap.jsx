import {
  useMemo,
} from "react";

import L from "leaflet";

import {
  AlertTriangle,
  Info,
  Layers3,
  LoaderCircle,
  MapPin,
} from "lucide-react";

import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
} from "react-leaflet";

import FortyGuardHeatLayer from "./FortyGuardHeatLayer.jsx";
import MockHeatLayer from "./MockHeatLayer.jsx";


const locationIcon =
  L.divIcon({
    className:
      "heatshield-marker-shell",

    html:
      '<div class="heatshield-map-pin"><span></span></div>',

    iconSize:
      [38, 46],

    iconAnchor:
      [19, 43],

    popupAnchor:
      [0, -38],
  });


const DEFAULT_STATE = {
  phase: "idle",
  activityId: null,
  providerStatus: null,
  mapData: null,
  featureCount: 0,
  request: null,
  error: null,
  fallbackReason: null,
};


export default function LiveHeatMap({
  heatmapState =
    DEFAULT_STATE,

  location,
}) {
  const markerPosition =
    useMemo(
      () => [
        location.latitude,
        location.longitude,
      ],
      [
        location.latitude,
        location.longitude,
      ],
    );

  const hasProviderMap =
    [
      "live",
      "replay",
    ].includes(
      heatmapState.phase,
    ) &&
    heatmapState.mapData;

  const isLive =
    heatmapState.phase ===
    "live";

  const isReplay =
    heatmapState.phase ===
    "replay";

  const isLoading =
    heatmapState.phase ===
    "loading";

  const showMock =
    heatmapState.phase ===
      "idle" ||
    heatmapState.phase ===
      "error";

  const dateTime =
    heatmapState.request
      ?.date_time;

  const badgeLabel =
    isLive
      ? "FortyGuard Live"
      : isReplay
        ? "Historical Replay"
        : isLoading
          ? "Analyzing"
          : "Demo Preview";

  const badgeClass =
    isLive
      ? "provider-live"
      : isReplay
        ? "provider-snapshot"
        : isLoading
          ? "provider-loading"
          : "provider-demo";

  return (
    <section className="panel map-panel">
      <div className="map-card-header">
        <div>
          <div className="section-eyebrow">
            SENSE
          </div>

          <div className="map-title">
            <h2>
              Heat Exposure Map
            </h2>

            <Info
              size={15}
              aria-label="Interactive FortyGuard heat intelligence map"
            />

            <span
              className={
                `map-data-badge ${badgeClass}`
              }
            >
              <i />

              {badgeLabel}
            </span>
          </div>
        </div>

        <div className="map-layer-select">
          <Layers3
            size={16}
          />

          Surface Temperature
        </div>
      </div>

      <div className="map-stage">
        <MapContainer
          center={
            markerPosition
          }
          zoom={12}
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

          {hasProviderMap ? (
            <FortyGuardHeatLayer
              activityId={
                heatmapState.activityId
              }
              data={
                heatmapState.mapData
              }
              markerPosition={
                markerPosition
              }
            />
          ) : null}

          {showMock ? (
            <MockHeatLayer />
          ) : null}

          <Marker
            position={
              markerPosition
            }
            icon={
              locationIcon
            }
            keyboard
          >
            <Tooltip
              className="map-city-tooltip"
              direction="bottom"
              offset={[0, 9]}
              opacity={1}
              permanent
            >
              <strong>
                {location.name}
              </strong>

              <span>
                {location.city},{" "}
                {location.state}
              </span>
            </Tooltip>

            <Popup className="heatshield-popup">
              <strong>
                {location.name}
              </strong>

              <span>
                {location.latitude.toFixed(
                  4,
                )}
                ,{" "}
                {location.longitude.toFixed(
                  4,
                )}
              </span>

              <span>
                {hasProviderMap
                  ? (
                    "Select a heat polygon "
                    + "to inspect provider values."
                  )
                  : (
                    "Selected HeatShield "
                    + "analysis location"
                  )}
              </span>
            </Popup>
          </Marker>

          <ZoomControl position="bottomright" />
        </MapContainer>

        <div
          className="map-request-status"
          aria-live="polite"
        >
          {isLoading ? (
            <div className="map-status-card status-loading">
              <LoaderCircle
                className="map-status-spinner"
                size={17}
              />

              <span>
                <strong>
                  Requesting FortyGuard heat intelligence
                </strong>

                Waiting for the
                provider job to
                complete.
              </span>
            </div>
          ) : null}

          {heatmapState.phase ===
          "error" ? (
            <div
              className="map-status-card status-error"
              role="alert"
            >
              <AlertTriangle
                size={17}
              />

              <span>
                <strong>
                  Heat intelligence unavailable
                </strong>

                {heatmapState.error}
              </span>
            </div>
          ) : null}

          {hasProviderMap ? (
            <div className="map-status-card status-provider">
              <MapPin
                size={15}
              />

              <span>
                <strong>
                  {
                    heatmapState.featureCount
                  }{" "}
                  FortyGuard heat
                  polygon
                  {heatmapState.featureCount ===
                  1
                    ? ""
                    : "s"}
                </strong>

                {dateTime?.start_date ??
                  "Unknown date"}{" "}
                ·{" "}
                {dateTime?.start_time ??
                  "--:--"}
              </span>
            </div>
          ) : null}

          {isReplay ? (
            <div className="map-status-card status-snapshot-note">
              <AlertTriangle
                size={15}
              />

              <span>
                <strong>
                  Historical replay mode
                </strong>

                Current provider
                evidence was not
                sufficient for the
                complete pipeline.

                {" "}

                HeatShield is replaying
                a verified FortyGuard
                historical observation
                with all pipeline stages
                aligned to the same time.
              </span>
            </div>
          ) : null}
        </div>

        <div
          className="map-legend"
          aria-label="Heat intensity legend"
        >
          <span>
            Lower Heat
          </span>

          <div className="heat-gradient" />

          <span>
            Extreme Heat
          </span>
        </div>
      </div>
    </section>
  );
}