const HEATMAP_RESULT_ENDPOINT =
  "/api/fortyguard/heatmap/result";

const ENVIRONMENT_RESULT_ENDPOINT =
  "/api/fortyguard/environment/result";

const CYCLE_PLAN_ENDPOINT =
  "/api/cycle/plan";

const DEFAULT_REQUEST_TIMEOUT_MS =
  180_000;

const AGENT_REQUEST_TIMEOUT_MS =
  300_000;

export const PHOENIX_LOCATION =
  Object.freeze({
    site_id: "PHX-DASHBOARD",
    name: "Phoenix Central City",
    city: "Phoenix",
    state: "Arizona",
    country: "United States",
    latitude: 33.4484,
    longitude: -112.074,
    timezone: "America/Phoenix",
  });

export const VERIFIED_SNAPSHOT_FILTER =
  Object.freeze({
    start_date: "2024-07-15",
    start_time: "14:00",
    filter_type: 1,
  });

export const VERIFIED_REPLAY_DATETIME =
  "2024-07-15T14:00:00-07:00";


export class HeatShieldApiError extends Error {
  constructor(
    message,
    {
      code = "api_error",
      status = null,
    } = {},
  ) {
    super(message);

    this.name =
      "HeatShieldApiError";

    this.code = code;
    this.status = status;
  }
}


function finiteNumber(value) {
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
    const parsed =
      Number(value);

    if (
      Number.isFinite(parsed)
    ) {
      return parsed;
    }
  }

  return null;
}


export function parseLocationInput(
  value,
) {
  const input =
    String(value ?? "")
      .trim();

  const normalized =
    input.toLowerCase();

  if (
    !input ||
    normalized === "phoenix" ||
    normalized ===
      "phoenix, arizona" ||
    normalized ===
      "phoenix arizona"
  ) {
    return {
      ...PHOENIX_LOCATION,
    };
  }

  const coordinateMatch =
    input.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/,
    );

  if (!coordinateMatch) {
    throw new HeatShieldApiError(
      (
        "For this build, enter Phoenix or Phoenix-area coordinates "
        + "like 33.4484, -112.0740."
      ),
      {
        code:
          "unsupported_search",
      },
    );
  }

  const latitude =
    Number(
      coordinateMatch[1],
    );

  const longitude =
    Number(
      coordinateMatch[2],
    );

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < 32.5 ||
    latitude > 34.6 ||
    longitude < -113.6 ||
    longitude > -111
  ) {
    throw new HeatShieldApiError(
      (
        "The first-screen demo currently supports "
        + "Phoenix metro coordinates only."
      ),
      {
        code:
          "outside_demo_area",
      },
    );
  }

  return {
    ...PHOENIX_LOCATION,

    name:
      "Custom Phoenix Coordinate",

    latitude,
    longitude,
  };
}


export function getCurrentPhoenixDateTimeFilter() {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          PHOENIX_LOCATION.timezone,

        year: "numeric",
        month: "2-digit",
        day: "2-digit",

        hour: "2-digit",

        hourCycle: "h23",
      },
    );

  const parts =
    Object.fromEntries(
      formatter
        .formatToParts(
          new Date(),
        )
        .filter(
          (part) =>
            part.type !==
            "literal",
        )
        .map(
          (part) => [
            part.type,
            part.value,
          ],
        ),
    );

  // Provider analysis is hourly.
  //
  // Never send arbitrary current minutes such as 16:37 when the
  // provider layer is expected to represent the current hour.
  return {
    start_date:
      `${parts.year}-${parts.month}-${parts.day}`,

    start_time:
      `${parts.hour}:00`,

    filter_type: 1,
  };
}


export function buildSquareAoi(
  latitude,
  longitude,
  radiusMeters = 300,
) {
  const lat =
    finiteNumber(latitude);

  const lon =
    finiteNumber(longitude);

  const radius =
    finiteNumber(
      radiusMeters,
    );

  if (
    lat === null ||
    lon === null ||
    radius === null ||
    radius <= 0
  ) {
    throw new HeatShieldApiError(
      (
        "A valid latitude, longitude "
        + "and AOI radius are required."
      ),
      {
        code:
          "invalid_location",
      },
    );
  }

  const latitudeDelta =
    radius / 111_320;

  const longitudeScale =
    111_320 *
    Math.cos(
      (lat * Math.PI) /
        180,
    );

  const longitudeDelta =
    radius /
    longitudeScale;

  const west =
    lon - longitudeDelta;

  const east =
    lon + longitudeDelta;

  const south =
    lat - latitudeDelta;

  const north =
    lat + latitudeDelta;

  return {
    type:
      "FeatureCollection",

    features: [
      {
        type:
          "Feature",

        properties: {},

        geometry: {
          type:
            "Polygon",

          coordinates: [
            [
              [
                west,
                south,
              ],
              [
                east,
                south,
              ],
              [
                east,
                north,
              ],
              [
                west,
                north,
              ],
              [
                west,
                south,
              ],
            ],
          ],
        },
      },
    ],
  };
}


export function createHeatmapRequest({
  latitude =
    PHOENIX_LOCATION.latitude,

  longitude =
    PHOENIX_LOCATION.longitude,

  radiusMeters = 300,

  granularity = 100,

  dateTime =
    VERIFIED_SNAPSHOT_FILTER,
} = {}) {
  return {
    polygon_aoi:
      buildSquareAoi(
        latitude,
        longitude,
        radiusMeters,
      ),

    date_time: {
      ...dateTime,
    },

    granularity,

    analytic_type: "tcm",
  };
}


function isFeatureCollection(
  value,
) {
  return (
    value?.type ===
      "FeatureCollection" &&
    Array.isArray(
      value.features,
    )
  );
}


function findFeatureCollection(
  mapData,
) {
  if (
    isFeatureCollection(
      mapData,
    )
  ) {
    return mapData;
  }

  const candidates = [
    mapData
      ?.feature_collection,

    mapData?.geojson,

    mapData?.data,

    mapData?.map,

    mapData?.result,
  ];

  return (
    candidates.find(
      isFeatureCollection,
    ) ?? null
  );
}


export function normalizeHeatmapMapData(
  mapData,
) {
  const collection =
    findFeatureCollection(
      mapData,
    );

  if (!collection) {
    throw new HeatShieldApiError(
      (
        "FortyGuard returned an unsupported "
        + "heatmap geometry shape."
      ),
      {
        code:
          "malformed_map_data",
      },
    );
  }

  const features =
    collection.features.filter(
      (feature) =>
        feature?.type ===
          "Feature" &&
        [
          "Polygon",
          "MultiPolygon",
        ].includes(
          feature
            ?.geometry
            ?.type,
        ) &&
        Array.isArray(
          feature
            ?.geometry
            ?.coordinates,
        ),
    );

  if (!features.length) {
    throw new HeatShieldApiError(
      (
        "FortyGuard returned no usable "
        + "heat polygons."
      ),
      {
        code:
          "empty_map_data",
      },
    );
  }

  return {
    ...collection,
    features,
  };
}


export function extractFeatureTemperature(
  properties = {},
) {
  for (
    const field
    of [
      "average_temperature",
      "temperature",
      "value",
    ]
  ) {
    const value =
      finiteNumber(
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


function pointInRing(
  longitude,
  latitude,
  ring,
) {
  let inside = false;

  for (
    let index = 0,
      previous =
        ring.length - 1;

    index < ring.length;

    previous = index,
      index += 1
  ) {
    const currentPoint =
      ring[index];

    const previousPoint =
      ring[previous];

    if (
      !Array.isArray(
        currentPoint,
      ) ||
      !Array.isArray(
        previousPoint,
      )
    ) {
      continue;
    }

    const currentX =
      Number(
        currentPoint[0],
      );

    const currentY =
      Number(
        currentPoint[1],
      );

    const previousX =
      Number(
        previousPoint[0],
      );

    const previousY =
      Number(
        previousPoint[1],
      );

    const intersects =
      currentY >
        latitude !==
        previousY >
        latitude &&
      longitude <
        (
          (
            previousX -
            currentX
          ) *
          (
            latitude -
            currentY
          )
        ) /
          (
            previousY -
              currentY ||
            Number.EPSILON
          ) +
          currentX;

    if (intersects) {
      inside =
        !inside;
    }
  }

  return inside;
}


function pointInPolygon(
  longitude,
  latitude,
  rings,
) {
  if (
    !Array.isArray(
      rings,
    ) ||
    !rings.length
  ) {
    return false;
  }

  if (
    !pointInRing(
      longitude,
      latitude,
      rings[0],
    )
  ) {
    return false;
  }

  for (
    let index = 1;
    index < rings.length;
    index += 1
  ) {
    if (
      pointInRing(
        longitude,
        latitude,
        rings[index],
      )
    ) {
      return false;
    }
  }

  return true;
}


function featureContainsPoint(
  feature,
  latitude,
  longitude,
) {
  const geometry =
    feature?.geometry;

  if (!geometry) {
    return false;
  }

  if (
    geometry.type ===
    "Polygon"
  ) {
    return pointInPolygon(
      longitude,
      latitude,
      geometry.coordinates,
    );
  }

  if (
    geometry.type ===
    "MultiPolygon"
  ) {
    return (
      geometry.coordinates.some(
        (polygon) =>
          pointInPolygon(
            longitude,
            latitude,
            polygon,
          ),
      )
    );
  }

  return false;
}


export function findContainingHeatFeature(
  mapData,
  latitude,
  longitude,
) {
  return (
    mapData.features.find(
      (feature) =>
        featureContainsPoint(
          feature,
          latitude,
          longitude,
        ),
    ) ?? null
  );
}


function responseMessage(
  body,
  fallback,
) {
  if (
    typeof body?.detail ===
      "string" &&
    body.detail.trim()
  ) {
    return body.detail;
  }

  if (
    typeof body?.message ===
      "string" &&
    body.message.trim()
  ) {
    return body.message;
  }

  return fallback;
}


async function requestJson(
  path,
  payload,
  {
    timeoutMs =
      DEFAULT_REQUEST_TIMEOUT_MS,
  } = {},
) {
  const controller =
    new AbortController();

  const timeout =
    window.setTimeout(
      () =>
        controller.abort(),
      timeoutMs,
    );

  try {
    const response =
      await fetch(
        path,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify(
              payload,
            ),

          signal:
            controller.signal,
        },
      );

    const text =
      await response.text();

    let body = null;

    if (text) {
      try {
        body =
          JSON.parse(
            text,
          );
      } catch {
        throw new HeatShieldApiError(
          (
            "The HeatShield backend "
            + "returned malformed JSON."
          ),
          {
            code:
              "malformed_response",

            status:
              response.status,
          },
        );
      }
    }

    if (!response.ok) {
      throw new HeatShieldApiError(
        responseMessage(
          body,
          (
            `Backend request failed with HTTP `
            + `${response.status}.`
          ),
        ),
        {
          code:
            "backend_error",

          status:
            response.status,
        },
      );
    }

    if (
      !body ||
      typeof body !==
        "object"
    ) {
      throw new HeatShieldApiError(
        (
          "The HeatShield backend "
          + "returned an empty response."
        ),
        {
          code:
            "empty_response",

          status:
            response.status,
        },
      );
    }

    return body;

  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new HeatShieldApiError(
        (
          "The HeatShield request "
          + "timed out."
        ),
        {
          code: "timeout",
        },
      );
    }

    if (
      error instanceof
      HeatShieldApiError
    ) {
      throw error;
    }

    throw new HeatShieldApiError(
      (
        "Unable to reach the "
        + "HeatShield backend."
      ),
      {
        code:
          "backend_unavailable",
      },
    );

  } finally {
    window.clearTimeout(
      timeout,
    );
  }
}


export async function fetchHeatmap(
  options = {},
) {
  const request =
    createHeatmapRequest(
      options,
    );

  const body =
    await requestJson(
      HEATMAP_RESULT_ENDPOINT,
      request,
      options,
    );

  const mapData =
    normalizeHeatmapMapData(
      body?.result
        ?.map_data,
    );

  if (
    typeof body.activity_id !==
      "string" ||
    !body.activity_id.trim()
  ) {
    throw new HeatShieldApiError(
      (
        "Heatmap data was returned "
        + "without an activity ID."
      ),
      {
        code:
          "missing_activity_id",
      },
    );
  }

  return {
    activityId:
      body.activity_id,

    status:
      typeof body.status ===
      "string"
        ? body.status
        : "Completed",

    mapData,

    statsData:
      body?.result
        ?.stats_data ??
      null,

    featureCount:
      mapData.features.length,

    request,
  };
}


export async function fetchEnvironmentForHeatmap(
  heatmap,
  location,
  options = {},
) {
  const feature =
    findContainingHeatFeature(
      heatmap.mapData,
      location.latitude,
      location.longitude,
    );

  if (!feature) {
    throw new HeatShieldApiError(
      (
        "No FortyGuard heat tile contains "
        + "the selected location."
      ),
      {
        code:
          "no_containing_tile",
      },
    );
  }

  const selectedTemperature =
    extractFeatureTemperature(
      feature.properties,
    );

  if (
    !selectedTemperature
  ) {
    throw new HeatShieldApiError(
      (
        "The containing FortyGuard heat tile "
        + "has no usable temperature."
      ),
      {
        code:
          "temperature_unavailable",
      },
    );
  }

  const payload = {
    latitude:
      location.latitude,

    longitude:
      location.longitude,

    temperature:
      selectedTemperature.value,

    date_time: {
      ...heatmap.request
        .date_time,
    },
  };

  const body =
    await requestJson(
      ENVIRONMENT_RESULT_ENDPOINT,
      payload,
      options,
    );

  const conditions =
    Array.isArray(
      body?.conditions,
    )
      ? body.conditions
      : [];

  if (
    !conditions.length
  ) {
    throw new HeatShieldApiError(
      (
        "FortyGuard returned no "
        + "environmental observations."
      ),
      {
        code:
          "environment_unavailable",
      },
    );
  }

  const condition =
    conditions.find(
      (item) =>
        finiteNumber(
          item?.location
            ?.lat,
        ) ===
          finiteNumber(
            location.latitude,
          ) &&
        finiteNumber(
          item?.location
            ?.lon,
        ) ===
          finiteNumber(
            location.longitude,
          ),
    ) ??
    conditions[0];

  return {
    activityId:
      body.activity_id ??
      null,

    status:
      body.status ??
      null,

    condition,

    conditions,

    request:
      payload,

    temperatureEvidence: {
      source:
        "fortyguard_heatmap",

      value:
        selectedTemperature.value,

      field:
        selectedTemperature.field,

      featureProperties:
        feature.properties ??
        {},
    },
  };
}


export function createCyclePlanRequest(
  location,
  {
    analysisDatetime =
      null,
  } = {},
) {
  return {
    location: {
      site_id:
        location.site_id,

      name:
        location.name,

      city:
        location.city,

      state:
        location.state,

      country:
        "United States",

      latitude:
        location.latitude,

      longitude:
        location.longitude,
    },

    timezone_name:
      location.timezone,

    analysis_datetime:
      analysisDatetime,

    worker: {
      worker_id:
        "DEMO-WORKER-01",

      site_id:
        location.site_id,

      acclimatized: true,

      ppe_level:
        "light",
    },

    task: {
      task_id:
        "DEMO-OUTDOOR-TASK",

      task_name:
        "Outdoor urban operations",

      workload_level:
        "moderate",

      exposure_duration_minutes:
        60,

      outdoor: true,

      direct_sun: true,
    },

    forecast_offset_hours:
      [1, 3, 6],

    include_spatial_intelligence:
      false,

    spatial_search_radius_meters:
      400,

    include_shift_optimization:
      false,
  };
}


export async function fetchCyclePlan(
  location,
  {
    analysisDatetime =
      null,

    timeoutMs =
      AGENT_REQUEST_TIMEOUT_MS,
  } = {},
) {
  const payload =
    createCyclePlanRequest(
      location,
      {
        analysisDatetime,
      },
    );

  const body =
    await requestJson(
      CYCLE_PLAN_ENDPOINT,
      payload,
      {
        timeoutMs,
      },
    );

  return {
    ...body,
    request: payload,
  };
}


export function formatScreeningBand(
  band,
) {
  const names = {
    below_caution:
      "Below Caution",

    caution:
      "Caution",

    extreme_caution:
      "Extreme Caution",

    danger:
      "Danger",

    extreme_danger:
      "Extreme Danger",
  };

  return (
    names[band] ??
    "Unavailable"
  );
}


export function deriveHeatIndexBand(
  heatIndexC,
) {
  const celsius =
    finiteNumber(
      heatIndexC,
    );

  if (
    celsius === null
  ) {
    return null;
  }

  const fahrenheit =
    (celsius * 9) /
      5 +
    32;

  if (
    fahrenheit < 80
  ) {
    return "below_caution";
  }

  if (
    fahrenheit < 90
  ) {
    return "caution";
  }

  if (
    fahrenheit < 103
  ) {
    return "extreme_caution";
  }

  if (
    fahrenheit < 125
  ) {
    return "danger";
  }

  return "extreme_danger";
}