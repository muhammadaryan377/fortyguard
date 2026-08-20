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

function responseMessage(body, fallback) {
  if (typeof body?.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body?.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

async function request(path, { method = "GET", payload, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
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

export function createAgenticCyclePayload(location, { analysisDatetime = null } = {}) {
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
    analysis_datetime: analysisDatetime,
    worker: {
      worker_id: "DEMO-WORKER-01",
      site_id: location.site_id,
      acclimatized: true,
      ppe_level: "light",
    },
    task: {
      task_id: "DEMO-OUTDOOR-TASK",
      task_name: "Outdoor urban operations",
      workload_level: "moderate",
      exposure_duration_minutes: 60,
      outdoor: true,
      direct_sun: true,
    },
    forecast_offset_hours: [1, 3, 6],
    include_spatial_intelligence: true,
    spatial_search_radius_meters: 600,
    include_shift_optimization: true,
    shift_tasks: [
      {
        task_id: "ZONE-SURVEY",
        task_name: "Outdoor zone survey",
        duration_minutes: 45,
        current_planned_offset_hours: 1,
        flexible: true,
        allowed_offset_hours: [1, 3, 6],
        workload_level: "moderate",
        direct_sun: true,
        must_follow_task_ids: [],
      },
      {
        task_id: "EQUIPMENT-CHECK",
        task_name: "Equipment inspection",
        duration_minutes: 30,
        current_planned_offset_hours: 3,
        flexible: true,
        allowed_offset_hours: [1, 3, 6],
        workload_level: "light",
        direct_sun: false,
        must_follow_task_ids: [],
      },
      {
        task_id: "FIELD-MAINTENANCE",
        task_name: "Field maintenance",
        duration_minutes: 60,
        current_planned_offset_hours: 6,
        flexible: true,
        allowed_offset_hours: [3, 6],
        workload_level: "heavy",
        direct_sun: true,
        must_follow_task_ids: ["ZONE-SURVEY"],
      },
    ],
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
