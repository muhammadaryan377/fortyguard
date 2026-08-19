import { useEffect, useMemo } from "react";
import L from "leaflet";
import { GeoJSON, Pane, useMap } from "react-leaflet";

const TEMPERATURE_FIELDS = ["average_temperature", "temperature"];

const finiteTemperature = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

function extractTcmTemperature(properties = {}) {
  for (const field of TEMPERATURE_FIELDS) {
    const value = finiteTemperature(properties[field]);
    if (value !== null) return { field, value };
  }
  return null;
}

const temperatureColor = (temperature) => {
  if (temperature === null) return "#718096";
  if (temperature < 30) return "#18c7a5";
  if (temperature < 32) return "#8dd843";
  if (temperature < 34) return "#ffd43b";
  if (temperature < 36) return "#ff8a16";
  if (temperature < 38) return "#ff4228";
  return "#dc123f";
};

const heatStyle = (feature) => {
  const temperature = extractTcmTemperature(feature?.properties)?.value ?? null;
  const color = temperatureColor(temperature);

  return {
    className: "fortyguard-heat-cell",
    color,
    fillColor: color,
    fillOpacity:
      temperature === null
        ? 0.2
        : Math.min(0.76, 0.34 + Math.max(0, temperature - 28) * 0.045),
    opacity: temperature === null ? 0.42 : 0.16,
    weight: 1,
  };
};

const displayTemperature = (value) => {
  const temperature = finiteTemperature(value);
  return temperature === null ? null : `${temperature.toFixed(1)}°C`;
};

const addPopupRow = (container, label, value) => {
  if (value === null || value === undefined || value === "") return;
  const row = document.createElement("span");
  const name = document.createElement("b");
  name.textContent = `${label}: `;
  row.append(name, document.createTextNode(String(value)));
  container.append(row);
};

const popupForFeature = (feature) => {
  const properties = feature?.properties ?? {};
  const selectedTemperature = extractTcmTemperature(properties);
  const popup = document.createElement("div");
  popup.className = "heat-feature-popup";

  const title = document.createElement("strong");
  title.textContent =
    properties.tile_id === null || properties.tile_id === undefined
      ? "FortyGuard heat tile"
      : `FortyGuard tile ${properties.tile_id}`;
  popup.append(title);

  if (selectedTemperature) {
    const label =
      selectedTemperature.field === "average_temperature"
        ? "Average temperature"
        : "Temperature";
    addPopupRow(popup, label, displayTemperature(selectedTemperature.value));
  } else {
    addPopupRow(popup, "Temperature", "Unavailable");
  }

  addPopupRow(popup, "Minimum", displayTemperature(properties.min_temperature));
  addPopupRow(popup, "Maximum", displayTemperature(properties.max_temperature));

  const providerClassification =
    properties.risk_level ?? properties.intensity ?? properties.classification;
  if (["string", "number"].includes(typeof providerClassification)) {
    addPopupRow(popup, "Provider classification", providerClassification);
  }

  return popup;
};

function FitHeatmapBounds({ data, markerPosition }) {
  const map = useMap();

  useEffect(() => {
    try {
      const bounds = L.geoJSON(data).getBounds();
      if (!bounds.isValid()) return;
      bounds.extend(markerPosition);
      map.fitBounds(bounds, { animate: true, maxZoom: 14, padding: [24, 24] });
    } catch (error) {
      if (import.meta.env?.DEV) {
        console.warn("HeatShield could not fit the returned heatmap bounds.", error);
      }
    }
  }, [data, map, markerPosition]);

  return null;
}

export default function FortyGuardHeatLayer({ data, activityId, markerPosition }) {
  const dataVersion = useMemo(
    () => `${activityId}:${data.features.length}`,
    [activityId, data.features.length],
  );

  useEffect(() => {
    if (!import.meta.env?.DEV) return;
    const missing = data.features.filter(
      (feature) => extractTcmTemperature(feature?.properties) === null,
    ).length;
    if (missing > 0) {
      console.warn(
        `FortyGuard returned ${missing} TCM feature(s) without average_temperature or temperature.`,
      );
    }
  }, [data]);

  return (
    <Pane name="fortyguard-heat-overlay" className="fortyguard-heat-pane" style={{ zIndex: 430 }}>
      <GeoJSON
        key={dataVersion}
        data={data}
        style={heatStyle}
        onEachFeature={(feature, layer) => layer.bindPopup(popupForFeature(feature))}
      />
      <FitHeatmapBounds data={data} markerPosition={markerPosition} />
    </Pane>
  );
}
