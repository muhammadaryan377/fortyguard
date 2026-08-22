import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MapPinned } from "lucide-react";

import { polygonCenter } from "./planWorkspace.js";

let googleLoader;
function loadGoogleMaps() {
  if (window.google?.maps) return Promise.resolve(window.google);
  if (googleLoader) return googleLoader;
  const key = import.meta.env.VITE_MAP;
  if (!key) return Promise.reject(new Error("Google Maps API key is not configured."));
  googleLoader = new Promise((resolve, reject) => {
    const callback = `heatShieldPlanGoogleMaps_${Date.now()}`;
    window[callback] = () => { delete window[callback]; resolve(window.google); };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${callback}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps could not be loaded."));
    document.head.appendChild(script);
  });
  return googleLoader;
}

const ZONE_STYLE = {
  work: { strokeColor: "#f97316", fillColor: "#fb923c", fillOpacity: .15, strokeWeight: 3 },
  recovery: { strokeColor: "#16a34a", fillColor: "#4ade80", fillOpacity: .17, strokeWeight: 3 },
  restricted: { strokeColor: "#dc2626", fillColor: "#f87171", fillOpacity: .1, strokeWeight: 3 },
  transit: { strokeColor: "#64748b", fillColor: "#94a3b8", fillOpacity: .08, strokeWeight: 2 },
};

function mapPoint(point) {
  return { lat: Number(point.latitude), lng: Number(point.longitude) };
}

export default function PlanMapEditor({
  site,
  crew = [],
  mode = "idle",
  activeWorkerId = null,
  activeZoneId = null,
  onMapClick,
  onVertexMove,
  height = 330,
}) {
  const nodeRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);
  const clickHandlerRef = useRef(onMapClick);
  const vertexMoveRef = useRef(onVertexMove);
  const modeRef = useRef(mode);
  const [status, setStatus] = useState("loading");
  const center = polygonCenter(site);
  const zones = site?.zones || [];
  const activeZone = zones.find((zone) => zone.id === activeZoneId) || null;
  const activeWorker = crew.find((worker) => worker.workerId === activeWorkerId) ?? null;

  useEffect(() => { clickHandlerRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { vertexMoveRef.current = onVertexMove; }, [onVertexMove]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((google) => {
      if (cancelled || !nodeRef.current) return;
      mapRef.current = new google.maps.Map(nodeRef.current, {
        center: { lat: Number(center[0]), lng: Number(center[1]) },
        zoom: 17,
        mapTypeId: "roadmap",
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
          mapTypeIds: ["roadmap", "satellite"],
        },
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: false,
        gestureHandling: "greedy",
      });
      mapRef.current.addListener("click", (event) => {
        if (!["draw", "zone", "worker"].includes(modeRef.current)) return;
        clickHandlerRef.current?.({ latitude: event.latLng.lat(), longitude: event.latLng.lng() });
      });
      setStatus("ready");
    }).catch(() => setStatus("error"));
    return () => { cancelled = true; };
    // Map instance is created once and redrawn from React state below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== "ready" || !window.google?.maps || !mapRef.current) return;
    const google = window.google;
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];
    const bounds = new google.maps.LatLngBounds();
    const masterPoints = (site?.polygon || []).map(mapPoint);

    if (masterPoints.length >= 2 && masterPoints.length < 3) {
      const line = new google.maps.Polyline({ map: mapRef.current, path: masterPoints, strokeColor: "#2563eb", strokeWeight: 3, zIndex: 3 });
      overlaysRef.current.push(line);
    }
    if (masterPoints.length >= 3) {
      const polygon = new google.maps.Polygon({
        map: mapRef.current,
        paths: masterPoints,
        strokeColor: "#2563eb",
        fillColor: "#60a5fa",
        strokeWeight: 3,
        fillOpacity: .055,
        clickable: false,
        zIndex: 3,
      });
      overlaysRef.current.push(polygon);
    }
    masterPoints.forEach((point) => bounds.extend(point));

    zones.forEach((zone) => {
      const points = (zone.polygon || []).map(mapPoint);
      const style = ZONE_STYLE[zone.type] || ZONE_STYLE.transit;
      if (points.length >= 2 && points.length < 3) {
        const line = new google.maps.Polyline({
          map: mapRef.current,
          path: points,
          strokeColor: style.strokeColor,
          strokeWeight: style.strokeWeight,
          strokeOpacity: zone.active ? 1 : .4,
          zIndex: 4,
        });
        overlaysRef.current.push(line);
      }
      if (points.length >= 3) {
        const polygon = new google.maps.Polygon({
          map: mapRef.current,
          paths: points,
          strokeColor: style.strokeColor,
          fillColor: style.fillColor,
          strokeWeight: style.strokeWeight,
          strokeOpacity: zone.active ? 1 : .42,
          fillOpacity: zone.active ? style.fillOpacity : .035,
          clickable: false,
          zIndex: 4,
        });
        overlaysRef.current.push(polygon);
      }
    });

    if (mode === "draw") {
      masterPoints.forEach((point, index) => {
        const marker = new google.maps.Marker({
          map: mapRef.current,
          position: point,
          label: { text: String(index + 1), color: "#ffffff", fontSize: "10px", fontWeight: "700" },
          title: `Master boundary point ${index + 1} · drag to edit`,
          draggable: true,
          zIndex: 20,
        });
        marker.addListener("dragend", (event) => {
          const accepted = vertexMoveRef.current?.("site", index, {
            latitude: event.latLng.lat(),
            longitude: event.latLng.lng(),
          });
          if (accepted === false) marker.setPosition(point);
        });
        overlaysRef.current.push(marker);
      });
    }

    if (mode === "zone") {
      const points = (activeZone?.polygon || []).map(mapPoint);
      points.forEach((point, index) => {
        const marker = new google.maps.Marker({
          map: mapRef.current,
          position: point,
          label: { text: String(index + 1), color: "#ffffff", fontSize: "10px", fontWeight: "700" },
          title: `${activeZone?.name || "Zone"} point ${index + 1} · drag to edit`,
          draggable: true,
          zIndex: 21,
        });
        marker.addListener("dragend", (event) => {
          const accepted = vertexMoveRef.current?.("zone", index, {
            latitude: event.latLng.lat(),
            longitude: event.latLng.lng(),
          }, activeZone?.id);
          if (accepted === false) marker.setPosition(point);
        });
        overlaysRef.current.push(marker);
      });
    }

    crew.forEach((worker, index) => {
      if (!worker.position) return;
      const position = mapPoint(worker.position);
      bounds.extend(position);
      const selected = activeWorkerId === worker.workerId;
      const marker = new google.maps.Marker({
        map: mapRef.current,
        position,
        label: {
          text: `${index + 1} · ${worker.name || worker.workerId}`,
          color: selected ? "#0f172a" : "#172033",
          fontSize: selected ? "12px" : "11px",
          fontWeight: "700",
          className: "hs-google-worker-label",
        },
        title: `${worker.workerId} · ${worker.zoneLabel || "work zone"}`,
        zIndex: selected ? 30 : 10 + index,
      });
      overlaysRef.current.push(marker);
    });

    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 44);
    else mapRef.current.setCenter({ lat: Number(center[0]), lng: Number(center[1]) });
  }, [activeWorkerId, activeZone, center, crew, mode, site, status, zones]);

  return (
    <div className={`hs-advanced-map mode-${mode}`}>
      <div style={{ position: "relative", height }}>
        <div ref={nodeRef} className="hs-advanced-leaflet" style={{ height: "100%" }} />
        {status === "loading" ? <div className="hs-map-cover"><LoaderCircle className="spinner" /> Loading Google Maps…</div> : null}
        {status === "error" ? <div className="hs-map-cover error"><MapPinned /> Google Maps unavailable. Check VITE_MAP and API restrictions.</div> : null}
      </div>
      <div className="hs-advanced-map-status">
        {mode === "draw" ? "Master boundary mode: click to add points or drag numbered vertices to correct the property edge. Use Satellite when the property edge is easier to see." : null}
        {mode === "zone" ? `Zone drawing: click to add points or drag numbered vertices inside the master boundary for ${activeZone?.name || "the selected operational zone"}.` : null}
        {mode === "worker" ? `Worker placement: click inside ${activeWorker?.zoneLabel || "the assigned work zone"} to place ${activeWorker?.name || activeWorkerId || "the selected worker"}.` : null}
        {mode === "idle" && crew.length ? `${site?.polygon?.length >= 3 ? "Master site locked" : "Site boundary incomplete"} · ${zones.filter((zone) => zone.active && zone.polygon?.length >= 3).length} active zones · ${crew.filter((worker) => worker.position).length}/${crew.length} worker positions.` : null}
        {mode === "idle" && !crew.length ? (site?.polygon?.length >= 3 ? `${zones.filter((zone) => zone.active && zone.polygon?.length >= 3).length} operational zones inside the master site.` : "Draw the master site boundary first.") : null}
      </div>
    </div>
  );
}
