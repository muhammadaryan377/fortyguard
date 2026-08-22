import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, MapPinned } from "lucide-react";

let googleLoader;
function loadGoogleMaps() {
  if (window.google?.maps) return Promise.resolve(window.google);
  if (googleLoader) return googleLoader;
  const key = import.meta.env.VITE_MAP;
  if (!key) return Promise.reject(new Error("Google Maps API key is not configured."));
  googleLoader = new Promise((resolve, reject) => {
    const callback = `heatShieldGoogleMaps_${Date.now()}`;
    window[callback] = () => { delete window[callback]; resolve(window.google); };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${callback}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps could not be loaded."));
    document.head.appendChild(script);
  });
  return googleLoader;
}

function heatTemperature(feature) {
  const properties = feature?.properties || {};
  for (const key of ["average_temperature", "temperature", "value"]) {
    const value = Number(properties[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function heatColor(value, minimum, maximum) {
  if (!Number.isFinite(value)) return "#94a3b8";
  const ratio = maximum === minimum ? .5 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  if (ratio < .25) return "#25a94f";
  if (ratio < .5) return "#d6df24";
  if (ratio < .75) return "#ff9f1a";
  return "#f04438";
}

function zoneStyle(type) {
  if (type === "recovery") return { strokeColor: "#16a34a", fillColor: "#22c55e", fillOpacity: .11 };
  if (type === "restricted") return { strokeColor: "#dc2626", fillColor: "#ef4444", fillOpacity: .09 };
  if (type === "transit") return { strokeColor: "#64748b", fillColor: "#94a3b8", fillOpacity: .07 };
  return { strokeColor: "#f97316", fillColor: "#fb923c", fillOpacity: .09 };
}

function heatPolygons(feature) {
  const geometry = feature?.geometry;
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates || [];
  return [];
}

export default function GoogleSiteMap({
  site,
  crew,
  heatFeatures = [],
  heatVisible,
  mapType,
  onMapClick,
  onWorkerMove,
  selectedWorkerId,
  onSelectWorker,
  workersDraggable = false,
  inspectionPoint = null,
}) {
  const nodeRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);
  const callbacksRef = useRef({ onMapClick, onWorkerMove, onSelectWorker });
  const viewportKeyRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const center = useMemo(() => {
    if (site?.polygon?.length) {
      return site.polygon.reduce((sum, point) => ({
        latitude: sum.latitude + Number(point.latitude) / site.polygon.length,
        longitude: sum.longitude + Number(point.longitude) / site.polygon.length,
      }), { latitude: 0, longitude: 0 });
    }
    return { latitude: Number(site?.seedLatitude), longitude: Number(site?.seedLongitude) };
  }, [site]);

  useEffect(() => {
    callbacksRef.current = { onMapClick, onWorkerMove, onSelectWorker };
  }, [onMapClick, onWorkerMove, onSelectWorker]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((google) => {
      if (cancelled || !nodeRef.current) return;
      mapRef.current = new google.maps.Map(nodeRef.current, {
        center: { lat: center.latitude, lng: center.longitude },
        zoom: 17,
        mapTypeId: mapType,
        streetViewControl: true,
        fullscreenControl: true,
        mapTypeControl: false,
        clickableIcons: false,
        gestureHandling: "greedy",
      });
      mapRef.current.addListener("click", (event) => callbacksRef.current.onMapClick?.({
        latitude: event.latLng.lat(),
        longitude: event.latLng.lng(),
      }));
      setStatus("ready");
    }).catch(() => setStatus("error"));
    return () => { cancelled = true; };
    // Map creation intentionally happens once. Callback refs keep interaction current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (mapRef.current) mapRef.current.setMapTypeId(mapType); }, [mapType]);

  useEffect(() => {
    if (status !== "ready" || !window.google?.maps || !mapRef.current) return;
    overlaysRef.current.forEach((overlay) => overlay.setMap?.(null));
    overlaysRef.current = [];
    const google = window.google;
    const bounds = new google.maps.LatLngBounds();
    const infoWindow = new google.maps.InfoWindow();

    const temperatures = heatFeatures.map(heatTemperature).filter(Number.isFinite);
    const minimum = temperatures.length ? Math.min(...temperatures) : 0;
    const maximum = temperatures.length ? Math.max(...temperatures) : 0;
    if (heatVisible) heatFeatures.forEach((feature) => {
      const temperature = heatTemperature(feature);
      heatPolygons(feature).forEach((rings) => {
        if (!Array.isArray(rings?.[0])) return;
        const polygon = new google.maps.Polygon({
          map: mapRef.current,
          paths: rings.map((ring) => ring.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))),
          strokeColor: "#ffffff",
          strokeOpacity: .18,
          strokeWeight: 1,
          fillColor: heatColor(temperature, minimum, maximum),
          fillOpacity: .46,
          clickable: true,
          zIndex: 1,
        });
        polygon.addListener("click", (event) => {
          const label = Number.isFinite(temperature) ? `${temperature.toFixed(1)}°C / ${Math.round((temperature * 9) / 5 + 32)}°F` : "Temperature unavailable";
          infoWindow.setContent(`<div style="font:600 12px system-ui;color:#20334a"><strong>FortyGuard TCM</strong><br/>${label}</div>`);
          infoWindow.setPosition(event.latLng);
          infoWindow.open({ map: mapRef.current });
        });
        overlaysRef.current.push(polygon);
      });
    });

    (site?.zones || []).filter((zone) => zone.active !== false && zone.polygon?.length >= 3).forEach((zone) => {
      const path = zone.polygon.map((point) => ({ lat: Number(point.latitude), lng: Number(point.longitude) }));
      const style = zoneStyle(zone.type);
      const polygon = new google.maps.Polygon({
        map: mapRef.current,
        paths: path,
        strokeColor: style.strokeColor,
        strokeWeight: zone.type === "restricted" ? 3 : 2,
        strokeOpacity: .95,
        fillColor: style.fillColor,
        fillOpacity: style.fillOpacity,
        clickable: false,
        zIndex: 2,
      });
      overlaysRef.current.push(polygon);
    });

    if (site?.polygon?.length >= 3) {
      const path = site.polygon.map((point) => ({ lat: Number(point.latitude), lng: Number(point.longitude) }));
      path.forEach((point) => bounds.extend(point));
      const boundary = new google.maps.Polygon({
        map: mapRef.current,
        paths: path,
        strokeColor: "#0f5eea",
        strokeWeight: 3,
        fillColor: "#1976ff",
        fillOpacity: .025,
        clickable: false,
        zIndex: 3,
      });
      overlaysRef.current.push(boundary);
    }

    crew.forEach((worker, index) => {
      if (!worker.position) return;
      const originalPosition = { lat: Number(worker.position.latitude), lng: Number(worker.position.longitude) };
      bounds.extend(originalPosition);
      const marker = new google.maps.Marker({
        map: mapRef.current,
        position: originalPosition,
        label: {
          text: worker.name || worker.workerId,
          color: "#172033",
          fontWeight: "700",
          fontSize: "11px",
          className: "hs-google-worker-label",
        },
        title: `${worker.workerId} · ${worker.currentTask}${worker.zoneLabel ? ` · ${worker.zoneLabel}` : ""}`,
        draggable: workersDraggable,
        zIndex: selectedWorkerId === worker.workerId ? 20 : 10 + index,
      });
      marker.addListener("click", () => callbacksRef.current.onSelectWorker?.(worker.workerId));
      if (workersDraggable) marker.addListener("dragend", (event) => {
        const accepted = callbacksRef.current.onWorkerMove?.(worker.workerId, {
          latitude: event.latLng.lat(),
          longitude: event.latLng.lng(),
        });
        if (accepted === false) marker.setPosition(originalPosition);
      });
      overlaysRef.current.push(marker);
    });

    if (inspectionPoint) {
      const marker = new google.maps.Marker({
        map: mapRef.current,
        position: { lat: Number(inspectionPoint.latitude), lng: Number(inspectionPoint.longitude) },
        title: "FortyGuard inspection point",
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#7c3aed",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
        zIndex: 30,
      });
      overlaysRef.current.push(marker);
    }

    const viewportKey = `${site?.id || "site"}:${(site?.polygon || []).map((point) => `${point.latitude},${point.longitude}`).join(";")}`;
    if (!bounds.isEmpty() && viewportKeyRef.current !== viewportKey) {
      mapRef.current.fitBounds(bounds, 50);
      viewportKeyRef.current = viewportKey;
    }
  }, [crew, heatFeatures, heatVisible, inspectionPoint, selectedWorkerId, site, status, workersDraggable]);

  return <div className="hs-google-map-shell"><div ref={nodeRef} className="hs-google-map" />{status === "loading" ? <div className="hs-map-cover"><LoaderCircle className="spinner"/> Loading Google Maps…</div> : null}{status === "error" ? <div className="hs-map-cover error"><MapPinned/>Google Maps unavailable. Check VITE_MAP and API restrictions.</div> : null}</div>;
}
