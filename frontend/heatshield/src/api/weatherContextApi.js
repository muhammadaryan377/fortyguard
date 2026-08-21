import { apiUrl } from "./apiBase.js";

const WEATHER_CACHE_MS = 5 * 60_000;
const weatherCache = new Map();

export async function fetchWeatherContext(location, options = {}) {
  const lat = Number(location?.latitude);
  const lon = Number(location?.longitude);
  const timezone = String(location?.timezone ?? "").trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !timezone) {
    throw new Error("A valid worksite and timezone are required for weather context.");
  }

  const key = `${lat.toFixed(4)},${lon.toFixed(4)},${timezone}`;
  const maxAgeMs = options.maxAgeMs ?? WEATHER_CACHE_MS;
  const cached = weatherCache.get(key);
  if (!options.force && cached && Date.now() - cached.savedAt < maxAgeMs) {
    return cached.value;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      timezone_name: timezone,
    });
    const response = await fetch(apiUrl(`/api/weather/context?${params.toString()}`), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.detail || `Weather context failed with HTTP ${response.status}.`);
    }
    weatherCache.set(key, { savedAt: Date.now(), value: body });
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Secondary weather context timed out.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
