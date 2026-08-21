import { apiUrl } from "./apiBase.js";

const LONG_TIMEOUT_MS = 300_000;

export class DecisionIntelligenceError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "DecisionIntelligenceError";
    this.status = status;
  }
}

async function post(path, payload, timeoutMs = LONG_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new DecisionIntelligenceError("HeatShield returned malformed JSON.", response.status);
      }
    }
    if (!response.ok) {
      const detail = typeof body?.detail === "string" ? body.detail : null;
      throw new DecisionIntelligenceError(detail || `HeatShield request failed with HTTP ${response.status}.`, response.status);
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new DecisionIntelligenceError("The FortyGuard intelligence request timed out.");
    }
    if (error instanceof DecisionIntelligenceError) throw error;
    throw new DecisionIntelligenceError("Unable to reach the HeatShield backend.");
  } finally {
    window.clearTimeout(timeout);
  }
}

function sitePolygon(site) {
  const points = Array.isArray(site?.polygon) ? site.polygon : [];
  if (points.length < 3) return null;
  const ring = points.map((point) => [Number(point.longitude), Number(point.latitude)]);
  ring.push([...ring[0]]);
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    }],
  };
}

function siteLocation(site) {
  const points = Array.isArray(site?.polygon) ? site.polygon : [];
  const latitude = points.length
    ? points.reduce((sum, point) => sum + Number(point.latitude), 0) / points.length
    : Number(site?.seedLatitude);
  const longitude = points.length
    ? points.reduce((sum, point) => sum + Number(point.longitude), 0) / points.length
    : Number(site?.seedLongitude);
  return {
    site_id: site.id,
    name: site.name || "HeatShield worksite",
    city: site.city,
    state: site.state,
    country: "United States",
    latitude,
    longitude,
  };
}

function workerLocation(site, worker) {
  return {
    site_id: site.id,
    name: `${site.name} · ${worker.name || worker.workerId}`,
    city: site.city,
    state: site.state,
    country: "United States",
    latitude: Number(worker.position.latitude),
    longitude: Number(worker.position.longitude),
  };
}

export async function fetchBoundedSpatialIntelligence(site, worker) {
  if (!site?.polygon?.length || !worker?.position) {
    throw new DecisionIntelligenceError("A site polygon and exact worker position are required.");
  }
  return post("/api/spatial/cooler-zones", {
    location: workerLocation(site, worker),
    timezone_name: site.timezone || "America/Phoenix",
    search_radius_meters: Number(site.spatialRadiusMeters || 800),
    granularity: 80,
    max_candidates: 5,
    operational_polygon: sitePolygon(site),
  });
}

export async function fetchPremiumCandidateIntelligence(site, candidate, analysisDatetime = null) {
  if (!candidate) {
    throw new DecisionIntelligenceError("Select a location candidate first.");
  }
  return post("/api/premium/location-intelligence", {
    latitude: Number(candidate.centroid_latitude),
    longitude: Number(candidate.centroid_longitude),
    timezone_name: site?.timezone || "America/Phoenix",
    analysis_datetime: analysisDatetime || site?.analysis_datetime || null,
    granularity: 80,
    include_satellite: true,
    include_street_view: true,
    street_vertical_angle: 10,
    street_horizontal_angle: 90,
    street_back_view: false,
  });
}

export async function fetchSiteResilience(site, { startDate, endDate, thresholdC = 35 } = {}) {
  const polygon = sitePolygon(site);
  if (!site || !polygon || !startDate || !endDate) {
    throw new DecisionIntelligenceError("A complete site polygon and historical date window are required.");
  }
  return post("/api/resilience/site-history", {
    location: siteLocation(site),
    timezone_name: site.timezone || "America/Phoenix",
    site_polygon: polygon,
    start_date: startDate,
    end_date: endDate,
    threshold_c: Number(thresholdC),
    granularity: 100,
  });
}
