import L from "leaflet";
import { ChevronDown, Info, Layers3 } from "lucide-react";
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
import MockHeatLayer from "./MockHeatLayer.jsx";

const PHOENIX = [33.4484, -112.074];

const locationIcon = L.divIcon({
  className: "heatshield-marker-shell",
  html: '<div class="heatshield-map-pin"><span></span></div>',
  iconSize: [38, 46],
  iconAnchor: [19, 43],
  popupAnchor: [0, -38],
});

export default function LiveHeatMap() {
  return (
    <section className="panel map-panel">
      <div className="map-card-header">
        <div className="map-title">
          <h2>Live Heat Map</h2>
          <Info size={16} aria-label="Interactive surface-temperature heat map" />
          <span className="live-indicator"><i /> Live</span>
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

          <MockHeatLayer />

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
              <span>Surface temperature: 33.1°C</span>
              <span>Heat index: 34.6°C</span>
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

        <div className="map-legend" aria-label="Heat intensity legend">
          <span>Lower Heat</span>
          <div className="heat-gradient" />
          <span>Extreme Heat</span>
        </div>
      </div>
    </section>
  );
}
