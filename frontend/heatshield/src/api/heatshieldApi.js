const HEATMAP_RESULT_ENDPOINT = "/api/fortyguard/heatmap/result";
const ENVIRONMENT_RESULT_ENDPOINT = "/api/fortyguard/environment/result";
const DEFAULT_REQUEST_TIMEOUT_MS = 150_000;

export const PHOENIX_DEMO_LOCATION = Object.freeze({
  name: "Phoenix Central City",
  latitude: 33.4484,
  longitude: -112.074,
  timezone: "America/Phoenix",
});

// A stable historical provider snapshot keeps the hackathon demo reproducible.
// The request still reaches FortyGuard live through the FastAPI backend.
export const PHOENIX_DEMO_FILTER = Object.freeze({
  start_date: "2024-07-15",
  start_time: "14:00",
  filter_type: 1,
});

export class HeatShieldApiError extends Error {
  constructor(message, { code = "api_error", status = null } = {}) {
    super(message);
    this.name = "HeatShieldApiError";
    this.code = code;
    this.status = status;
  }
}

const finiteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function buildSquareAoi(latitude, longitude, radiusMeters = 300) {
  const lat = finiteNumber(latitude);
  const lon = finiteNumber(longitude);
  const radius = finiteNumber(radiusMeters);

  if (lat === null || lon === null || radius === null || radius <= 0) {
    throw new HeatShieldApiError("A valid location and AOI radius are required.", {
      code: "invalid_location",
    });
  }

  const latitudeDelta = radius / 111_320;
  const longitudeScale = 111_320 * Math.cos((lat * Math.PI) / 180);
  const longitudeDelta = radius / longitudeScale;
  const west = lon - longitudeDelta;
  const east = lon + longitudeDelta;
  const south = lat - latitudeDelta;
  const north = lat + latitudeDelta;

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [[
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ]],
        },
      },
    ],
  };
}

export function createPhoenixHeatmapRequest({
  latitude = PHOENIX_DEMO_LOCATION.latitude,
  longitude = PHOENIX_DEMO_LOCATION.longitude,
  radiusMeters = 300,
  granularity = 100,
  dateTime = PHOENIX_DEMO_FILTER,
} = {}) {
  return {
    polygon_aoi: buildSquareAoi(latitude, longitude, radiusMeters),
    date_time: { ...dateTime },
    granularity,
    analytic_type: "tcm",
  };
}

const isFeatureCollection = (value) =>
  value?.type === "FeatureCollection" && Array.isArray(value.features);

const findFeatureCollection = (mapData) => {
  if (isFeatureCollection(mapData)) return mapData;

  for (const key of ["feature_collection", "geojson", "data"]) {
    if (isFeatureCollection(mapData?.[key])) return mapData[key];
  }

  return null;
};

export function normalizeHeatmapMapData(mapData) {
  const collection = findFeatureCollection(mapData);
  if (!collection) {
    throw new HeatShieldApiError("FortyGuard returned an unsupported heatmap geometry shape.", {
      code: "malformed_map_data",
    });
  }

  if (collection.features.length === 0) {
    throw new HeatShieldApiError("FortyGuard returned no heat features for this area and time.", {
      code: "empty_map_data",
    });
  }

  const features = collection.features.filter(
    (feature) =>
      feature?.type === "Feature" &&
      ["Polygon", "MultiPolygon"].includes(feature.geometry?.type) &&
      Array.isArray(feature.geometry?.coordinates),
  );

  if (features.length === 0) {
    throw new HeatShieldApiError("FortyGuard returned no supported heat polygons.", {
      code: "unsupported_geometry",
    });
  }

  if (import.meta.env?.DEV && features.length !== collection.features.length) {
    console.warn(
      `HeatShield ignored ${collection.features.length - features.length} unsupported heat feature(s).`,
    );
  }

  return { ...collection, features };
}

const responseMessage = (body, fallback) => {
  if (typeof body?.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body?.message === "string" && body.message.trim()) return body.message;
  return fallback;
};

async function requestJson(path, payload, { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;

    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new HeatShieldApiError("The HeatShield backend returned malformed JSON.", {
          code: "malformed_response",
          status: response.status,
        });
      }
    }

    if (!response.ok) {
      throw new HeatShieldApiError(
        responseMessage(body, `HeatShield backend request failed with HTTP ${response.status}.`),
        { code: "backend_error", status: response.status },
      );
    }

    if (!body || typeof body !== "object") {
      throw new HeatShieldApiError("The HeatShield backend returned an empty response.", {
        code: "malformed_response",
        status: response.status,
      });
    }

    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new HeatShieldApiError("The live heatmap request timed out.", {
        code: "timeout",
      });
    }
    if (error instanceof HeatShieldApiError) throw error;
    throw new HeatShieldApiError("Unable to reach the HeatShield backend.", {
      code: "backend_unavailable",
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchHeatmap(options = {}) {
  const request = createPhoenixHeatmapRequest(options);
  const body = await requestJson(HEATMAP_RESULT_ENDPOINT, request, options);
  const mapData = normalizeHeatmapMapData(body?.result?.map_data);

  if (typeof body.activity_id !== "string" || !body.activity_id.trim()) {
    throw new HeatShieldApiError("HeatShield returned heat geometry without an activity ID.", {
      code: "missing_activity_id",
    });
  }

  return {
    activityId: body.activity_id,
    status: typeof body.status === "string" ? body.status : "Completed",
    mapData,
    statsData: body?.result?.stats_data ?? null,
    request,
    featureCount: mapData.features.length,
  };
}

export async function fetchEnvironmentalConditions(payload, options = {}) {
  if (!payload || typeof payload !== "object") {
    throw new HeatShieldApiError("An environmental request payload is required.", {
      code: "invalid_environment_request",
    });
  }
  return requestJson(ENVIRONMENT_RESULT_ENDPOINT, payload, options);
}
