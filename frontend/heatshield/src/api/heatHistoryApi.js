const HEATMAP_RESULT_ENDPOINT = "/api/fortyguard/heatmap/result";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asFeatureCollection(value) {
  if (value?.type === "FeatureCollection" && Array.isArray(value.features)) return value;
  const candidates = [value?.feature_collection, value?.geojson, value?.data, value?.map, value?.result];
  return candidates.find((candidate) => candidate?.type === "FeatureCollection" && Array.isArray(candidate.features)) || null;
}

function featureTemperature(feature) {
  const properties = feature?.properties || {};
  for (const key of ["average_temperature", "temperature", "value"]) {
    const value = finiteNumber(properties[key]);
    if (value !== null) return value;
  }
  return null;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function sitePolygonAoi(site) {
  const points = Array.isArray(site?.polygon) ? site.polygon : [];
  if (points.length < 3) throw new Error("Select a saved site with a complete boundary before running Heat History.");
  const ring = points.map((point) => [Number(point.longitude), Number(point.latitude)]);
  if (ring.some(([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude))) {
    throw new Error("The selected site boundary contains invalid coordinates.");
  }
  const [firstLongitude, firstLatitude] = ring[0];
  const [lastLongitude, lastLatitude] = ring[ring.length - 1];
  if (firstLongitude !== lastLongitude || firstLatitude !== lastLatitude) ring.push([firstLongitude, firstLatitude]);
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { site_id: site.id }, geometry: { type: "Polygon", coordinates: [ring] } }],
  };
}

export function historicalSampleDates(days) {
  const safeDays = Math.max(2, Number(days) || 30);
  const offsets = [1, Math.max(2, Math.round(safeDays / 2)), Math.max(3, safeDays - 1)];
  return [...new Set(offsets)].slice(0, 3).map((offset) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    return dateString(date);
  });
}

async function requestHistoricalHeatmap(site, date, granularity) {
  const response = await fetch(HEATMAP_RESULT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      polygon_aoi: sitePolygonAoi(site),
      date_time: { start_date: date, start_time: "14:00", filter_type: 1 },
      granularity: Number(granularity),
      analytic_type: "tcm",
    }),
  });

  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : typeof body?.message === "string" ? body.message : `Historical heatmap request failed with HTTP ${response.status}.`;
    throw new Error(detail);
  }

  const collection = asFeatureCollection(body?.result?.map_data);
  const features = (collection?.features || []).filter((feature) => feature?.geometry?.coordinates && featureTemperature(feature) !== null);
  if (!features.length) throw new Error(`FortyGuard returned no populated historical heat cells for ${date} at 14:00.`);

  const normalizedFeatures = features.map((feature) => ({
    ...feature,
    properties: { ...feature.properties, temperature: featureTemperature(feature) },
  }));
  return { date, activityId: body?.activity_id || null, features: normalizedFeatures };
}

export async function analyzeSiteHeatHistory({ site, days = 30, thresholdF = 95, granularity = 100 }) {
  const thresholdC = (Number(thresholdF) - 32) * 5 / 9;
  const dates = historicalSampleDates(days);
  const samples = [];
  const failures = [];

  for (const date of dates) {
    try {
      // Keep provider work sequential so a three-sample history run cannot fan out into concurrent credit usage.
      // eslint-disable-next-line no-await-in-loop
      samples.push(await requestHistoricalHeatmap(site, date, granularity));
    } catch (error) {
      failures.push({ date, message: error?.message || "Historical sample unavailable." });
    }
  }

  if (!samples.length) {
    throw new Error(failures[0]?.message || "No FortyGuard historical evidence was available for this site and period.");
  }

  const temperatures = samples.flatMap((sample) => sample.features.map((feature) => featureTemperature(feature)).filter((value) => value !== null));
  const exceedances = temperatures.filter((value) => value >= thresholdC).length;
  const meanC = temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length;
  const peakC = Math.max(...temperatures);

  return {
    siteId: site.id,
    siteName: site.name,
    days: Number(days),
    thresholdF: Number(thresholdF),
    thresholdC,
    granularity: Number(granularity),
    sampleTime: "14:00",
    requestedSamples: dates.length,
    completedSamples: samples.length,
    failures,
    samples,
    meanC,
    peakC,
    exceedancePercent: temperatures.length ? (exceedances / temperatures.length) * 100 : 0,
    featureCount: temperatures.length,
    latestFeatures: samples[samples.length - 1]?.features || [],
  };
}
