import { GeoJSON, Pane } from "react-leaflet";
import { mockHeatGeoJson } from "../../data/mockHeatData.js";

const temperatureColor = (temperature) => {
  if (temperature < 30) return "#18c7a5";
  if (temperature < 32) return "#8dd843";
  if (temperature < 34) return "#ffd43b";
  if (temperature < 36) return "#ff8a16";
  if (temperature < 38) return "#ff4228";
  return "#dc123f";
};

const heatStyle = (feature) => {
  const temperature = feature?.properties?.average_temperature;
  const color = temperatureColor(temperature ?? 0);

  return {
    className: "mock-heat-cell",
    color,
    fillColor: color,
    fillOpacity: Math.min(0.76, 0.34 + Math.max(0, temperature - 28) * 0.045),
    opacity: 0.12,
    weight: 1,
  };
};

/**
 * Mock provider layer only. Replace `data` with normalized FortyGuard
 * `map_data` later without changing the Leaflet map shell.
 */
export default function MockHeatLayer({ data = mockHeatGeoJson }) {
  const dataVersion = data.features
    .map((feature) => `${feature.properties.tile_id}:${feature.properties.average_temperature}`)
    .join("|");

  return (
    <Pane name="mock-heat-overlay" className="mock-heat-pane" style={{ zIndex: 430 }}>
      <GeoJSON
        key={dataVersion}
        data={data}
        style={heatStyle}
        interactive={false}
      />
    </Pane>
  );
}
