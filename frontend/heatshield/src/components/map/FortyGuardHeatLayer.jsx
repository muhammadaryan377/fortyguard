import { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  GeoJSON,
  Pane,
  useMap,
} from "react-leaflet";

const TEMPERATURE_FIELDS = [
  "average_temperature",
  "temperature",
  "value",
];

function finiteTemperature(value) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractTemperature(properties = {}) {
  for (const field of TEMPERATURE_FIELDS) {
    const value = finiteTemperature(
      properties[field],
    );

    if (value !== null) {
      return {
        field,
        value,
      };
    }
  }

  return null;
}

function temperatureColor(temperature) {
  if (temperature === null) {
    return "#718096";
  }

  if (temperature < 30) {
    return "#19c7a5";
  }

  if (temperature < 32) {
    return "#8ed844";
  }

  if (temperature < 34) {
    return "#ffd43b";
  }

  if (temperature < 36) {
    return "#ff961a";
  }

  if (temperature < 38) {
    return "#ff482f";
  }

  return "#db1741";
}

function heatStyle(feature) {
  const selected =
    extractTemperature(
      feature?.properties,
    );

  const temperature =
    selected?.value ?? null;

  const color =
    temperatureColor(temperature);

  return {
    className:
      "fortyguard-heat-cell",

    color,

    fillColor: color,

    fillOpacity:
      temperature === null
        ? 0.18
        : Math.min(
            0.78,
            0.34 +
              Math.max(
                0,
                temperature - 28,
              ) *
                0.045,
          ),

    opacity:
      temperature === null
        ? 0.35
        : 0.18,

    weight: 1,
  };
}

function displayTemperature(value) {
  const parsed =
    finiteTemperature(value);

  if (parsed === null) {
    return null;
  }

  return `${parsed.toFixed(1)}°C`;
}

function addPopupRow(
  container,
  label,
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return;
  }

  const row =
    document.createElement("span");

  const name =
    document.createElement("b");

  name.textContent = `${label}: `;

  row.append(
    name,
    document.createTextNode(
      String(value),
    ),
  );

  container.append(row);
}

function popupForFeature(feature) {
  const properties =
    feature?.properties ?? {};

  const selectedTemperature =
    extractTemperature(properties);

  const popup =
    document.createElement("div");

  popup.className =
    "heat-feature-popup";

  const title =
    document.createElement("strong");

  const tileId =
    properties.tile_id ??
    properties.id ??
    properties.feature_id;

  title.textContent =
    tileId === null ||
    tileId === undefined
      ? "FortyGuard heat tile"
      : `FortyGuard tile ${tileId}`;

  popup.append(title);

  if (selectedTemperature) {
    const labels = {
      average_temperature:
        "Average temperature",

      temperature:
        "Temperature",

      value:
        "TCM temperature",
    };

    addPopupRow(
      popup,
      labels[selectedTemperature.field],
      displayTemperature(
        selectedTemperature.value,
      ),
    );
  } else {
    addPopupRow(
      popup,
      "Temperature",
      "Unavailable",
    );
  }

  addPopupRow(
    popup,
    "Minimum",
    displayTemperature(
      properties.min_temperature ??
        properties.minimum_temperature,
    ),
  );

  addPopupRow(
    popup,
    "Maximum",
    displayTemperature(
      properties.max_temperature ??
        properties.maximum_temperature,
    ),
  );

  const classification =
    properties.risk_level ??
    properties.intensity ??
    properties.classification;

  if (
    typeof classification ===
      "string" ||
    typeof classification ===
      "number"
  ) {
    addPopupRow(
      popup,
      "Classification",
      classification,
    );
  }

  return popup;
}

function FitHeatmapBounds({
  data,
  markerPosition,
}) {
  const map = useMap();

  useEffect(() => {
    try {
      const bounds =
        L.geoJSON(data).getBounds();

      if (!bounds.isValid()) {
        return;
      }

      if (
        Array.isArray(
          markerPosition,
        )
      ) {
        bounds.extend(
          markerPosition,
        );
      }

      map.fitBounds(bounds, {
        animate: true,
        maxZoom: 15,
        padding: [28, 28],
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(
          "Unable to fit FortyGuard heatmap bounds.",
          error,
        );
      }
    }
  }, [data, map, markerPosition]);

  return null;
}

export default function FortyGuardHeatLayer({
  data,
  activityId,
  markerPosition,
}) {
  const dataVersion = useMemo(
    () =>
      `${activityId ?? "provider"}:${data.features.length}`,
    [
      activityId,
      data.features.length,
    ],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    const missing =
      data.features.filter(
        (feature) =>
          !extractTemperature(
            feature?.properties,
          ),
      ).length;

    if (missing > 0) {
      console.warn(
        `${missing} FortyGuard heat polygon(s) did not expose a recognized TCM temperature field.`,
      );
    }
  }, [data]);

  return (
    <Pane
      name="fortyguard-heat-overlay"
      className="fortyguard-heat-pane"
      style={{
        zIndex: 430,
      }}
    >
      <GeoJSON
        key={dataVersion}
        data={data}
        style={heatStyle}
        onEachFeature={(
          feature,
          layer,
        ) => {
          layer.bindPopup(
            popupForFeature(
              feature,
            ),
          );
        }}
      />

      <FitHeatmapBounds
        data={data}
        markerPosition={
          markerPosition
        }
      />
    </Pane>
  );
}