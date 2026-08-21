export const SITE_STORAGE_KEY = "heatshield.savedSites.v3";
export const SELECTED_SITE_STORAGE_KEY = "heatshield.selectedSite.v3";
export const CREW_STORAGE_KEY = "heatshield.siteCrews.v3";
export const MAX_AGENT_WORKERS = 10;

export const ZONE_TYPES = [
  { value: "work", label: "Work zone" },
  { value: "recovery", label: "Recovery zone" },
  { value: "restricted", label: "Restricted / no-go" },
  { value: "transit", label: "Transit / other" },
];

export const TASK_OPTIONS = [
  "Outdoor field work",
  "Materials move",
  "Equipment inspection",
  "Roof work",
  "Loading / unloading",
  "Indoor support",
  "Documentation / inventory",
];

export function readStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The setup remains usable in-memory if browser storage is unavailable.
  }
}

export function locationLabel(location) {
  const raw = location?.name || location?.city || "Worksite";
  return raw === "Phoenix Central City" ? "Phoenix Yard" : raw;
}

function copyPolygon(polygon) {
  return Array.isArray(polygon)
    ? polygon.map((point) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude) }))
      .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
    : [];
}

export function createZone(index = 1, type = "work") {
  const labels = {
    work: "Work Area",
    recovery: "Recovery Area",
    restricted: "Restricted Area",
    transit: "Transit / Other",
  };
  return {
    id: `ZONE-${Date.now()}-${index}`,
    name: `${labels[type] || "Zone"} ${index}`,
    type,
    polygon: [],
    active: true,
    relocationAllowed: type === "work" || type === "recovery",
  };
}

export function normalizeZone(zone, index = 0) {
  const type = ["work", "recovery", "restricted", "transit"].includes(zone?.type) ? zone.type : "work";
  return {
    id: String(zone?.id || `ZONE-${index + 1}`),
    name: String(zone?.name || `Zone ${index + 1}`),
    type,
    polygon: copyPolygon(zone?.polygon),
    active: zone?.active !== false,
    relocationAllowed: zone?.relocationAllowed ?? (type === "work" || type === "recovery"),
    legacyGenerated: Boolean(zone?.legacyGenerated),
  };
}

export function normalizeSite(site) {
  const polygon = copyPolygon(site?.polygon);
  let zones = Array.isArray(site?.zones) ? site.zones.map(normalizeZone) : [];
  if (!zones.length && polygon.length >= 3) {
    zones = [{
      id: "ZONE-PRIMARY",
      name: "Primary Work Area",
      type: "work",
      polygon: copyPolygon(polygon),
      active: true,
      relocationAllowed: true,
      legacyGenerated: true,
    }];
  }
  return {
    ...site,
    polygon,
    zones,
    spatialRadiusMeters: Number(site?.spatialRadiusMeters || 800),
  };
}

export function seedSite(location, id = null) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  return {
    id: id || location?.site_id || `SITE-${Date.now()}`,
    name: locationLabel(location),
    city: location?.city || "Phoenix",
    state: location?.state || "Arizona",
    country: "United States",
    timezone: location?.timezone || "America/Phoenix",
    address: location?.display_name || "",
    seedLatitude: Number.isFinite(latitude) ? latitude : 33.4484,
    seedLongitude: Number.isFinite(longitude) ? longitude : -112.074,
    analysis_datetime: location?.analysis_datetime ?? null,
    polygon: [],
    zones: [],
    spatialRadiusMeters: 800,
  };
}

export function loadSites(location) {
  const saved = readStorage(SITE_STORAGE_KEY, []);
  if (Array.isArray(saved) && saved.length) return saved.map(normalizeSite);
  return [seedSite(location)];
}

export function loadSelectedSiteId(sites) {
  const savedId = readStorage(SELECTED_SITE_STORAGE_KEY, null);
  if (savedId && sites.some((site) => site.id === savedId)) return savedId;
  return sites[0]?.id ?? null;
}

export function loadCrewMap() {
  const saved = readStorage(CREW_STORAGE_KEY, {});
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
}

export function saveSites(sites) {
  writeStorage(SITE_STORAGE_KEY, sites.map(normalizeSite));
}

export function saveSelectedSiteId(siteId) {
  writeStorage(SELECTED_SITE_STORAGE_KEY, siteId);
}

export function saveCrewMap(crewMap) {
  writeStorage(CREW_STORAGE_KEY, crewMap);
}

export function polygonCenter(site) {
  const points = site?.polygon ?? [];
  if (points.length) {
    return [
      points.reduce((sum, point) => sum + Number(point.latitude), 0) / points.length,
      points.reduce((sum, point) => sum + Number(point.longitude), 0) / points.length,
    ];
  }
  return [Number(site?.seedLatitude || 33.4484), Number(site?.seedLongitude || -112.074)];
}

export function polygonCenterPoint(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return null;
  return {
    latitude: polygon.reduce((sum, point) => sum + Number(point.latitude), 0) / polygon.length,
    longitude: polygon.reduce((sum, point) => sum + Number(point.longitude), 0) / polygon.length,
  };
}

export function pointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  const x = Number(point.longitude);
  const y = Number(point.latitude);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i].longitude);
    const yi = Number(polygon[i].latitude);
    const xj = Number(polygon[j].longitude);
    const yj = Number(polygon[j].latitude);
    const denominator = yj - yi;
    const intersects = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / denominator + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function zoneById(site, zoneId) {
  return (site?.zones || []).find((zone) => zone.id === zoneId) || null;
}

export function activeWorkZones(site) {
  return (site?.zones || []).filter((zone) => zone.active && zone.type === "work" && zone.polygon?.length >= 3);
}

export function activeCandidateZones(site) {
  return (site?.zones || []).filter((zone) => (
    zone.active
    && zone.relocationAllowed
    && ["work", "recovery"].includes(zone.type)
    && zone.polygon?.length >= 3
  ));
}

export function pointInAnyZone(point, zones) {
  return (zones || []).some((zone) => pointInPolygon(point, zone.polygon || []));
}

export function zoneForPoint(site, point, types = null) {
  return (site?.zones || []).find((zone) => (
    zone.active
    && (!types || types.includes(zone.type))
    && pointInPolygon(point, zone.polygon || [])
  )) || null;
}

export function workerPositionValid(worker, site) {
  const zone = zoneById(site, worker?.zoneId);
  return Boolean(
    worker?.position
    && zone
    && zone.active
    && zone.type === "work"
    && pointInPolygon(worker.position, site?.polygon || [])
    && pointInPolygon(worker.position, zone.polygon || [])
  );
}

export function polygonAreaAcres(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  const meanLat = polygon.reduce((sum, point) => sum + Number(point.latitude), 0) / polygon.length;
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos((meanLat * Math.PI) / 180);
  let twiceArea = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const x1 = Number(current.longitude) * lonScale;
    const y1 = Number(current.latitude) * latScale;
    const x2 = Number(next.longitude) * lonScale;
    const y2 = Number(next.latitude) * latScale;
    twiceArea += x1 * y2 - x2 * y1;
  }
  return Math.abs(twiceArea) / 2 / 4046.8564224;
}

export function nextWorkerNumber(crew) {
  const used = new Set(crew.map((worker) => worker.workerId));
  let number = 1;
  while (used.has(`WORKER-${String(number).padStart(2, "0")}`)) number += 1;
  return number;
}

export function createWorker(crew) {
  const number = nextWorkerNumber(crew);
  return {
    workerId: `WORKER-${String(number).padStart(2, "0")}`,
    name: `Worker ${String(number).padStart(2, "0")}`,
    zoneId: "",
    zoneLabel: "",
    position: null,
    allowedZoneIds: [],
    shiftStart: "06:00",
    shiftEnd: "18:00",
    currentTask: "Outdoor field work",
    workload: "moderate",
    duration: 60,
    ppe: "light",
    clothingFactor: 0,
    outdoor: true,
    directSun: true,
    acclimatized: true,
    reassignAllowed: true,
    alternateTask: "Indoor support",
    alternateWorkload: "light",
    alternateDuration: 45,
    alternateDirectSun: false,
  };
}

export function cToF(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number * 9) / 5 + 32) : null;
}

export function formatTimestamp(value, timezone = undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    }).format(date);
  }
}
