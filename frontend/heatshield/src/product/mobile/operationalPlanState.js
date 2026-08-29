const SESSION_PLAN_KEY = "heatshield.operationalPlan.session.v1";
const PLAN_SUMMARY_KEY = "heatshield.operationalPlan.summary.v1";

function storageRead(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storageWrite(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function pointSignature(point) {
  if (!point) return null;
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return [Number(latitude.toFixed(6)), Number(longitude.toFixed(6))];
}

export function workspaceFingerprint(site, crew) {
  if (!site) return "";
  const compact = {
    siteId: String(site.id || site.site_id || ""),
    polygon: (site.polygon || []).map(pointSignature).filter(Boolean),
    zones: (site.zones || []).map((zone) => ({
      id: String(zone.id || ""),
      type: String(zone.type || ""),
      active: zone.active !== false,
      relocationAllowed: Boolean(zone.relocationAllowed),
      polygon: (zone.polygon || []).map(pointSignature).filter(Boolean),
    })),
    crew: (crew || []).map((worker) => ({
      workerId: String(worker.workerId || ""),
      name: String(worker.name || ""),
      zoneId: String(worker.zoneId || ""),
      position: pointSignature(worker.position),
      shiftStart: worker.shiftStart || "",
      shiftEnd: worker.shiftEnd || "",
      currentTask: worker.currentTask || "",
      workload: worker.workload || "",
      duration: Number(worker.duration || 0),
      ppe: worker.ppe || "",
      outdoor: worker.outdoor !== false,
      directSun: Boolean(worker.directSun),
      acclimatized: Boolean(worker.acclimatized),
      reassignAllowed: Boolean(worker.reassignAllowed),
      allowedZoneIds: [...(worker.allowedZoneIds || [])].sort(),
      alternateTask: worker.alternateTask || "",
      alternateWorkload: worker.alternateWorkload || "",
      alternateDuration: Number(worker.alternateDuration || 0),
    })),
  };
  return JSON.stringify(compact);
}

function safeReasonForAction(cycle, action) {
  if (!action) return null;
  const trace = (cycle?.agent_decision?.tool_trace || []).find((item) => item.action_id === action.action_id);
  return trace?.safe_reason || action.details?.label || null;
}

export function buildOperationalSummary(site, crew, snapshot, agentPlan) {
  const workers = (agentPlan?.results || []).map((result) => {
    const configured = (crew || []).find((worker) => worker.workerId === result.worker_id) || {};
    const snapshotWorker = (snapshot?.workers || []).find((worker) => worker.worker_id === result.worker_id) || {};
    const cycle = result.cycle || {};
    const assessment = cycle.current_assessment || {};
    const environment = assessment.environmental_evidence || {};
    const screening = assessment.screening || {};
    const actions = cycle.agent_decision?.actions || [];
    const primaryAction = actions.find((action) => action.status === "proposed") || actions[0] || null;
    return {
      workerId: result.worker_id,
      cycleId: cycle.cycle_id || null,
      name: configured.name || snapshotWorker.display_label || result.worker_id,
      zoneId: configured.zoneId || snapshotWorker.zone_id || null,
      zoneLabel: configured.zoneLabel || snapshotWorker.zone_name || null,
      taskName: configured.currentTask || snapshotWorker.task_name || null,
      attentionOrder: snapshotWorker.attention_order || null,
      attentionGroup: snapshotWorker.attention_group || null,
      band: screening.band || null,
      agentStatus: cycle.agent_decision?.status || null,
      environment: {
        temperature_c: environment.temperature_c ?? environment.verified_temperature_c ?? null,
        apparent_temperature_c: environment.apparent_temperature_c ?? null,
        heat_index_c: environment.heat_index_c ?? null,
        relative_humidity_percent: environment.relative_humidity_percent ?? environment.relative_humidity ?? null,
        timestamp: environment.timestamp || null,
      },
      primaryAction: primaryAction ? {
        actionId: primaryAction.action_id,
        actionType: primaryAction.action_type,
        status: primaryAction.status,
        safeReason: safeReasonForAction(cycle, primaryAction),
      } : null,
    };
  });

  return {
    siteId: String(site?.id || site?.site_id || ""),
    siteName: site?.name || snapshot?.location?.name || "Worksite",
    fingerprint: workspaceFingerprint(site, crew),
    savedAt: new Date().toISOString(),
    generatedAt: agentPlan?.generated_at || snapshot?.generated_at || new Date().toISOString(),
    snapshotId: snapshot?.snapshot_id || agentPlan?.snapshot_id || null,
    status: snapshot?.status || null,
    summary: snapshot?.summary || null,
    providerUsage: snapshot?.provider_usage || null,
    workers,
  };
}

export function saveOperationalPlan(site, crew, snapshot, agentPlan) {
  const summary = buildOperationalSummary(site, crew, snapshot, agentPlan);
  storageWrite(window.localStorage, PLAN_SUMMARY_KEY, summary);
  storageWrite(window.sessionStorage, SESSION_PLAN_KEY, {
    ...summary,
    snapshot,
    agentPlan,
  });
  return summary;
}

export function loadOperationalSummary(site, crew) {
  const summary = storageRead(window.localStorage, PLAN_SUMMARY_KEY);
  if (!summary || summary.siteId !== String(site?.id || site?.site_id || "")) return null;
  if (summary.fingerprint !== workspaceFingerprint(site, crew)) return null;
  return summary;
}

export function loadOperationalPlan(site, crew) {
  const session = storageRead(window.sessionStorage, SESSION_PLAN_KEY);
  if (!session || session.siteId !== String(site?.id || site?.site_id || "")) return null;
  if (session.fingerprint !== workspaceFingerprint(site, crew)) return null;
  if (!session.snapshot || !session.agentPlan) return null;
  return session;
}

export function clearOperationalPlan() {
  try { window.localStorage.removeItem(PLAN_SUMMARY_KEY); } catch { /* no-op */ }
  try { window.sessionStorage.removeItem(SESSION_PLAN_KEY); } catch { /* no-op */ }
}
