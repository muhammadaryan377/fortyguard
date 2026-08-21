import { apiUrl } from "./apiBase.js";

const DEFAULT_TIMEOUT_MS = 180_000;
const AGENT_TIMEOUT_MS = 300_000;

export class AgenticApiError extends Error {
  constructor(message, { code = "api_error", status = null } = {}) {
    super(message);
    this.name = "AgenticApiError";
    this.code = code;
    this.status = status;
  }
}

function validationDetailMessage(detail) {
  if (!Array.isArray(detail) || !detail.length) return null;

  const messages = detail
    .map((item) => {
      const location = Array.isArray(item?.loc)
        ? item.loc.filter((part) => part !== "body").join(".")
        : "";
      const message = typeof item?.msg === "string" ? item.msg : "Invalid value";
      return location ? `${location}: ${message}` : message;
    })
    .filter(Boolean);

  return messages.length ? `Request validation failed — ${messages.join("; ")}` : null;
}

function responseMessage(body, fallback) {
  if (typeof body?.detail === "string" && body.detail.trim()) return body.detail;
  const validationMessage = validationDetailMessage(body?.detail);
  if (validationMessage) return validationMessage;
  if (typeof body?.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

async function request(path, { method = "GET", payload, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl(path), {
      method,
      headers: {
        Accept: "application/json",
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new AgenticApiError("HeatShield returned malformed JSON.", {
          code: "malformed_response",
          status: response.status,
        });
      }
    }
    if (!response.ok) {
      throw new AgenticApiError(
        responseMessage(body, `HeatShield request failed with HTTP ${response.status}.`),
        { code: "backend_error", status: response.status },
      );
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AgenticApiError("HeatShield request timed out.", { code: "timeout" });
    }
    if (error instanceof AgenticApiError) throw error;
    throw new AgenticApiError("Unable to reach the HeatShield backend.", {
      code: "backend_unavailable",
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function cycleEndpoint(cycleId, suffix) {
  if (!cycleId || typeof cycleId !== "string") {
    throw new AgenticApiError("A valid HeatShield cycle ID is required.", {
      code: "invalid_cycle",
    });
  }
  return `/api/cycle/${encodeURIComponent(cycleId)}${suffix}`;
}

function normalizeWorkload(value) {
  return ["light", "moderate", "heavy", "very_heavy"].includes(value)
    ? value
    : "moderate";
}

function normalizePpe(value) {
  return ["none", "light", "moderate", "heavy"].includes(value)
    ? value
    : "light";
}

export function locationSupportsFortyGuard(location) {
  if (typeof location?.fortyguard_supported === "boolean") {
    return location.fortyguard_supported;
  }
  return String(location?.country ?? "").trim().toLowerCase() === "united states";
}

export function createAgenticCyclePayload(location, options = {}) {
  if (!locationSupportsFortyGuard(location)) {
    throw new AgenticApiError(
      "FortyGuard worksite heat intelligence is currently available for U.S. locations. Select a supported U.S. worksite to build an occupational heat plan.",
      { code: "fortyguard_location_unsupported" },
    );
  }

  const workerOptions = options.worker ?? {};
  const taskOptions = options.task ?? {};
  const includeShiftOptimization = Boolean(options.includeShiftOptimization);
  const shiftTasks = Array.isArray(options.shiftTasks) && options.shiftTasks.length
    ? options.shiftTasks
    : null;

  return {
    location: {
      site_id: location.site_id,
      name: location.name,
      city: location.city,
      state: location.state,
      country: "United States",
      latitude: location.latitude,
      longitude: location.longitude,
    },
    timezone_name: location.timezone,
    analysis_datetime: options.analysisDatetime ?? null,
    worker: {
      worker_id: workerOptions.worker_id ?? "WORKER-01",
      site_id: location.site_id,
      acclimatized: workerOptions.acclimatized ?? true,
      ppe_level: normalizePpe(workerOptions.ppe_level),
    },
    task: {
      task_id: taskOptions.task_id ?? "FIELD-TASK-01",
      task_name: String(taskOptions.task_name ?? "Outdoor field work").trim() || "Outdoor field work",
      workload_level: normalizeWorkload(taskOptions.workload_level),
      exposure_duration_minutes: Number(taskOptions.exposure_duration_minutes ?? 60),
      outdoor: true,
      direct_sun: taskOptions.direct_sun ?? true,
    },
    forecast_offset_hours: options.forecastOffsetHours ?? [1, 3],
    include_spatial_intelligence: options.includeSpatialIntelligence ?? true,
    spatial_search_radius_meters: options.spatialSearchRadiusMeters ?? 600,
    include_shift_optimization: includeShiftOptimization && Boolean(shiftTasks),
    shift_tasks: includeShiftOptimization && shiftTasks ? shiftTasks : null,
  };
}

export async function fetchAgenticCycle(location, options = {}) {
  const payload = createAgenticCyclePayload(location, options);
  const body = await request("/api/cycle/plan", {
    method: "POST",
    payload,
    timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MS,
  });
  return { ...body, request: payload };
}

export async function searchLocations(query, options = {}) {
  const value = String(query ?? "").trim();
  if (value.length < 2) {
    throw new AgenticApiError("Enter a city, address, landmark, or coordinates.", {
      code: "invalid_location_query",
    });
  }
  return request(`/api/location/search?q=${encodeURIComponent(value)}`, {
    timeoutMs: options.timeoutMs ?? 20_000,
  });
}

export async function reverseLocation(latitude, longitude, options = {}) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new AgenticApiError("Valid map coordinates are required.", {
      code: "invalid_coordinates",
    });
  }
  return request(
    `/api/location/reverse?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`,
    { timeoutMs: options.timeoutMs ?? 20_000 },
  );
}

export async function approveCycleActions(cycleId, actionIds, supervisorId, options = {}) {
  if (!Array.isArray(actionIds) || !actionIds.length) {
    throw new AgenticApiError("Select at least one proposed action.", {
      code: "no_actions_selected",
    });
  }
  const supervisor = String(supervisorId ?? "").trim();
  if (!supervisor) {
    throw new AgenticApiError("Supervisor authorization is required.", {
      code: "missing_supervisor",
    });
  }
  return request(cycleEndpoint(cycleId, "/approve"), {
    method: "POST",
    payload: { supervisor_id: supervisor, action_ids: actionIds },
    timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MS,
  });
}

export async function verifyCycle(cycleId, options = {}) {
  return request(cycleEndpoint(cycleId, "/verify"), {
    method: "POST",
    payload: {},
    timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MS,
  });
}

export async function recheckCycle(cycleId, options = {}) {
  return request(cycleEndpoint(cycleId, "/recheck"), {
    method: "POST",
    payload: {},
    timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MS,
  });
}

export async function fetchCycleAudit(cycleId, options = {}) {
  return request(cycleEndpoint(cycleId, "/audit"), {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}
