export const ACTION_COPY = {
  cool_recovery: {
    title: "Use a cool recovery break",
    how: "Pause the heat-exposed task and use an available shaded or cooled recovery area. The supervisor records the control before work resumes.",
  },
  reduce_physical_demands: {
    title: "Reduce physical demand",
    how: "Lower pace, split the task, rotate effort, or use mechanical assistance where available. Recheck conditions before returning to the original workload.",
  },
  consider_cooler_sampled_period: {
    title: "Move flexible work to a cooler sampled time",
    how: "If operations allow, move the task to the provider-sampled period shown below. Recheck fresh conditions before the task starts; a cooler sample is not a safe-time guarantee.",
  },
  increase_monitoring: {
    title: "Increase worker monitoring",
    how: "Use more frequent supervisor or buddy check-ins during the exposure window and document the checks in the work plan.",
  },
  limit_direct_sun: {
    title: "Reduce direct sun exposure",
    how: "Move the task into shade where feasible, use temporary shade, or change task positioning so direct solar exposure is reduced.",
  },
  supervisor_review: {
    title: "Supervisor review required",
    how: "A supervisor reviews current heat evidence, task conditions and the selected controls before work continues under the plan.",
  },
  consider_cooler_zone: {
    title: "Use the cooler nearby candidate",
    how: "Check the mapped candidate for access, task feasibility and other hazards first. If suitable, use it as a lower-temperature work or recovery candidate; it is not automatically a safe zone.",
  },
  consider_shift_plan: {
    title: "Use the lower-temperature shift candidate",
    how: "Apply the sampled-start schedule only if task dependencies and operations allow it, then recheck fresh conditions before execution.",
  },
};

export const BAND_LABEL = {
  below_caution: "Below caution",
  caution: "Caution",
  extreme_caution: "Extreme caution",
  danger: "Danger",
  extreme_danger: "Extreme danger",
};

export function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function metric(value, digits = 1) {
  return finite(value) === null ? "--" : Number(value).toFixed(digits);
}

export function humanize(value) {
  if (!value) return "Unavailable";
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatWhen(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function mapStateFromCycle(cycle) {
  const spatial = cycle?.spatial_heat;
  const tiles = spatial?.tiles ?? [];
  if (!tiles.length) {
    return {
      phase: "idle",
      activityId: null,
      mapData: null,
      featureCount: 0,
    };
  }
  return {
    phase: "live",
    activityId: spatial.heatmap_activity_id,
    featureCount: tiles.length,
    mapData: {
      type: "FeatureCollection",
      features: tiles.map((tile) => ({
        type: "Feature",
        properties: {
          tile_id: tile.tile_id,
          temperature: tile.temperature_c,
          contains_site: tile.contains_site,
          straight_line_distance_m: tile.straight_line_distance_m,
        },
        geometry: {
          type: "Polygon",
          coordinates: tile.polygon_coordinates,
        },
      })),
    },
  };
}

export function actionWhy(action, cycle) {
  const details = action?.details ?? {};
  const band = BAND_LABEL[cycle?.current_assessment?.screening?.band] ?? "current heat screening";
  if (action.action_type === "consider_cooler_zone") {
    return `${metric(details.cooler_by_c)}°C cooler provider tile about ${Math.round(details.straight_line_distance_m ?? 0)} m away from the selected site.`;
  }
  if (action.action_type === "consider_cooler_sampled_period") {
    const difference = finite(details.difference_from_current_c);
    const coolerBy = difference === null ? null : Math.abs(difference);
    const when = formatWhen(details.requested_local_timestamp);
    return `${coolerBy === null ? "A" : `${metric(coolerBy)}°C`} cooler provider sample${when ? ` at ${when}` : ""}.`;
  }
  if (action.action_type === "limit_direct_sun") {
    return `This task is marked as direct-sun work while current Heat Index screening is ${band}.`;
  }
  if (action.action_type === "reduce_physical_demands") {
    return `Current heat screening is ${band} and the selected task workload is ${humanize(cycle?.current_assessment?.task_context?.workload_level)}.`;
  }
  if (action.action_type === "cool_recovery") {
    return `Current heat screening is ${band}; deterministic controls support a cooling or recovery control.`;
  }
  if (action.action_type === "increase_monitoring") {
    return `Current heat screening is ${band}; deterministic controls support closer worker monitoring.`;
  }
  if (action.action_type === "supervisor_review") {
    return "HeatShield always permits supervisor review as a human safety gate.";
  }
  return (action.reason_codes ?? []).map(humanize).join(" · ") || "Selected from the current provider-backed evidence.";
}

export function locationLabel(location) {
  return location.display_name || `${location.name}, ${location.city}, ${location.state}`;
}
