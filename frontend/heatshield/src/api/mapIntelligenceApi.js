import { fetchHeatmap } from "./heatshieldApi.js";

const CACHE_PREFIX = "heatshield.mapHeat.v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

function siteCenter(site) {
  const points = Array.isArray(site?.polygon) ? site.polygon : [];
  if (points.length) {
    return {
      latitude: points.reduce((sum, point) => sum + Number(point.latitude), 0) / points.length,
      longitude: points.reduce((sum, point) => sum + Number(point.longitude), 0) / points.length,
    };
  }
  return {
    latitude: Number(site?.seedLatitude || 33.4484),
    longitude: Number(site?.seedLongitude || -112.074),
  };
}

function distanceMeters(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function siteRadius(site, center) {
  const points = Array.isArray(site?.polygon) ? site.polygon : [];
  const furthest = points.reduce((maximum, point) => Math.max(maximum, distanceMeters(center, {
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
  })), 0);
  return Math.max(250, Math.min(2000, Math.ceil(furthest + 120)));
}

function dateTimeFilter(site) {
  const timezone = site?.timezone || "America/Phoenix";
  const source = site?.analysis_datetime ? new Date(site.analysis_datetime) : new Date();
  if (Number.isNaN(source.getTime())) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(formatter.formatToParts(source)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]));
    return {
      start_date: `${parts.year}-${parts.month}-${parts.day}`,
      start_time: `${parts.hour}:00`,
      filter_type: 1,
    };
  } catch {
    return null;
  }
}

function fingerprint(site, center, radiusMeters, dateTime) {
  return [
    site?.id || "site",
    center.latitude.toFixed(5),
    center.longitude.toFixed(5),
    radiusMeters,
    dateTime?.start_date || "current",
    dateTime?.start_time || "hour",
    (site?.polygon || []).map((point) => `${Number(point.latitude).toFixed(5)},${Number(point.longitude).toFixed(5)}`).join("|"),
  ].join(":");
}

function readCache(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    return parsed.value || null;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // The map still works when browser storage is unavailable.
  }
}

export async function fetchSelectedSiteHeatmap(site, { force = false } = {}) {
  if (!site) throw new Error("Select a site before loading FortyGuard heat intelligence.");
  const center = siteCenter(site);
  const radiusMeters = siteRadius(site, center);
  const dateTime = dateTimeFilter(site);
  const cacheKey = `${CACHE_PREFIX}:${fingerprint(site, center, radiusMeters, dateTime)}`;
  if (!force) {
    const cached = readCache(cacheKey);
    if (cached) return { ...cached, cacheHit: true };
  }
  const heatmap = await fetchHeatmap({
    latitude: center.latitude,
    longitude: center.longitude,
    radiusMeters,
    granularity: 80,
    ...(dateTime ? { dateTime } : {}),
  });
  const result = {
    ...heatmap,
    siteCenter: center,
    radiusMeters,
    requestedDateTime: dateTime,
  };
  writeCache(cacheKey, result);
  return { ...result, cacheHit: false };
}
