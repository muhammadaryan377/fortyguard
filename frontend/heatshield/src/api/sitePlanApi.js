import { apiUrl } from "./apiBase.js";

const SITE_TIMEOUT_MS = 360_000;
const AGENT_TIMEOUT_MS = 600_000;

export class SitePlanApiError extends Error {
  constructor(message, { status = null, code = "site_plan_error" } = {}) {
    super(message);
    this.name = "SitePlanApiError";
    this.status = status;
    this.code = code;
  }
}

function validationDetail(detail) {
  if (!Array.isArray(detail)) return null;
  const messages = detail.map((item) => {
    const path = Array.isArray(item?.loc)
      ? item.loc.filter((part) => part !== "body").join(".")
      : "";
    return path ? `${path}: ${item?.msg ?? "Invalid value"}` : item?.msg;
  }).filter(Boolean);
  return messages.length ? messages.join("; ") : null;
}

function messageFromBody(body, fallback) {
  if (typeof body?.detail === "string") return body.detail;
  const validation = validationDetail(body?.detail);
  if (validation) return `Request validation failed — ${validation}`;
  if (typeof body?.message === "string") return body.message;
  return fallback;
}

async function request(path, { method = "GET", payload, timeoutMs = SITE_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
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
        throw new SitePlanApiError("HeatShield returned malformed JSON.", {
          status: response.status,
          code: "malformed_response",
        });
      }
    }
    if (!response.ok) {
      throw new SitePlanApiError(
        messageFromBody(body, `HeatShield request failed with HTTP ${response.status}.`),
        { status: response.status, code: "backend_error" },
      );
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new SitePlanApiError("The advanced site plan timed out. Try fewer workers or retry the scan.", {
        code: "timeout",
      });
    }
    if (error instanceof SitePlanApiError) throw error;
    throw new SitePlanApiError("Unable to reach the HeatShield backend.", {
      code: "backend_unavailable",
    });
  } finally {
    window.clearTimeout(timer);
  }
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

function closeRing(points) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new SitePlanApiError("Draw at least three site boundary points on the map.", {
      code: "site_polygon_required",
    });
  }
  const ring = points.map((point) => [Number(point.longitude), Number(point.latitude)]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring;
}

function centroid(points) {
  const usable = points.filter((point) => Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)));
  if (!usable.length) return null;
  return {
    latitude: usable.reduce((sum, point) => sum + Number(point.latitude), 0) / usable.length,
    longitude: usable.reduce((sum, point) => sum + Number(point.longitude), 0) / usable.length,
  };
}

function taskId(workerId, suffix) {
  return `${String(workerId).replace(/[^A-Za-z0-9_-]/g, "-")}-${suffix}`.slice(0, 100);
}

function shiftTasks(worker) {
  if (!worker.reassignAllowed) return null;
  const allowed = [1, 3, 6, 9, 12];
  const primary = {
    task_id: taskId(worker.workerId, "PRIMARY"),
    task_name: String(worker.currentTask || "Current task"),
    duration_minutes: Math.max(15, Number(worker.duration || 60)),
    current_planned_offset_hours: 1,
    flexible: true,
    allowed_offset_hours: allowed,
    workload_level: normalizeWorkload(worker.workload),
    direct_sun: Boolean(worker.directSun),
    must_follow_task_ids: [],
  };
  if (!worker.alternateTask || worker.alternateTask === worker.currentTask) return [primary];
  return [
    primary,
    {
      task_id: taskId(worker.workerId, "ALT"),
      task_name: String(worker.alternateTask),
      duration_minutes: Math.max(15, Number(worker.alternateDuration || 45)),
      current_planned_offset_hours: 3,
      flexible: true,
      allowed_offset_hours: allowed,
      workload_level: normalizeWorkload(worker.alternateWorkload || worker.workload),
      direct_sun: Boolean(worker.alternateDirectSun),
      must_follow_task_ids: [],
    },
  ];
}

export function createSiteSnapshotPayload(site, crew) {
  if (!site?.polygon?.length) {
    throw new SitePlanApiError("Select a saved site and draw its full boundary before building the plan.", {
      code: "site_polygon_required",
    });
  }
  if (!Array.isArray(crew) || !crew.length) {
    throw new SitePlanApiError("Add at least one worker before building the plan.", {
      code: "worker_required",
    });
  }

  const center = centroid(site.polygon);
  if (!center) throw new SitePlanApiError("The selected site boundary is invalid.");
  const siteId = String(site.id || site.site_id || "WORKSITE");
  const assignments = crew.map((worker, index) => {
    const latitude = Number(worker?.position?.latitude);
    const longitude = Number(worker?.position?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new SitePlanApiError(`${worker.name || `Worker ${index + 1}`} needs an exact map position.`);
    }
    return {
      display_label: String(worker.name || worker.workerId || `Worker ${index + 1}`),
      position: {
        latitude,
        longitude,
        label: worker.zoneLabel || worker.position?.label || null,
      },
      worker: {
        worker_id: String(worker.workerId || `WORKER-${String(index + 1).padStart(2, "0")}`),
        site_id: siteId,
        zone_id: String(worker.zoneId || worker.zoneLabel || `ZONE-${index + 1}`).slice(0, 100),
        acclimatized: Boolean(worker.acclimatized),
        ppe_level: normalizePpe(worker.ppe),
      },
      task: {
        task_id: taskId(worker.workerId || `WORKER-${index + 1}`, "NOW"),
        task_name: String(worker.currentTask || "Outdoor field work"),
        workload_level: normalizeWorkload(worker.workload),
        exposure_duration_minutes: Math.max(0, Number(worker.duration || 0)),
        outdoor: worker.outdoor !== false,
        direct_sun: Boolean(worker.directSun),
      },
      shift_tasks: shiftTasks(worker),
    };
  });

  return {
    location: {
      site_id: siteId,
      name: String(site.name || "Selected worksite"),
      city: String(site.city || "Phoenix"),
      state: String(site.state || "Arizona"),
      country: "United States",
      latitude: center.latitude,
      longitude: center.longitude,
    },
    timezone_name: String(site.timezone || "America/Phoenix"),
    site_polygon: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { site_id: siteId, name: String(site.name || "Selected worksite") },
          geometry: { type: "Polygon", coordinates: [closeRing(site.polygon)] },
        },
      ],
    },
    analysis_datetime: site.analysis_datetime ?? null,
    assignments,
    forecast_offset_hours: [1, 3, 6, 9, 12],
    include_prediction: true,
    include_spatial_intelligence: true,
    spatial_search_radius_meters: Number(site.spatialRadiusMeters || 800),
    include_shift_optimization: assignments.some((item) => Array.isArray(item.shift_tasks) && item.shift_tasks.length),
    max_spatial_candidates: 5,
    heatmap_granularity: 60,
  };
}

export async function createSiteSnapshot(site, crew, options = {}) {
  const payload = createSiteSnapshotPayload(site, crew);
  const body = await request("/api/site/operations-snapshot", {
    method: "POST",
    payload,
    timeoutMs: options.timeoutMs ?? SITE_TIMEOUT_MS,
  });
  return { ...body, request: payload };
}

export async function createSiteAgentPlan(snapshotId, workerIds, options = {}) {
  if (!snapshotId) throw new SitePlanApiError("A site snapshot is required before the agent plan can run.");
  const ids = [...new Set((workerIds ?? []).map((value) => String(value)).filter(Boolean))];
  if (!ids.length) throw new SitePlanApiError("Select at least one worker for the agent plan.");
  return request(`/api/site/operations-snapshot/${encodeURIComponent(snapshotId)}/agent-plan`, {
    method: "POST",
    payload: { worker_ids: ids },
    timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MS,
  });
}
