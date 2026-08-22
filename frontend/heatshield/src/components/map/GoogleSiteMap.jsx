import { useEffect, useRef, useState } from "react";
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

function heatColor(value, minimum, maximum) {
  if (!Number.isFinite(value)) return "#94a3b8";
  const ratio = maximum === minimum ? .5 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  if (ratio < .25) return "#25a94f";
  if (ratio < .5) return "#d6df24";
  if (ratio < .75) return "#ff9f1a";
  return "#f04438";
}

export default function GoogleSiteMap({ site, crew, heatFeatures = [], heatVisible, mapType, onMapClick, onWorkerMove, selectedWorkerId, onSelectWorker }) {
  const nodeRef = useRef(null);
  const mapRef = useRef(null);
  const overlaysRef = useRef([]);
  const [status, setStatus] = useState("loading");
  const center = site?.polygon?.length ? site.polygon.reduce((sum, point) => ({ latitude: sum.latitude + Number(point.latitude) / site.polygon.length, longitude: sum.longitude + Number(point.longitude) / site.polygon.length }), { latitude: 0, longitude: 0 }) : { latitude: Number(site?.seedLatitude), longitude: Number(site?.seedLongitude) };

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((google) => {
      if (cancelled || !nodeRef.current) return;
      mapRef.current = new google.maps.Map(nodeRef.current, { center: { lat: center.latitude, lng: center.longitude }, zoom: 17, mapTypeId: mapType, streetViewControl: true, fullscreenControl: true, mapTypeControl: false, clickableIcons: false });
      mapRef.current.addListener("click", (event) => onMapClick?.({ latitude: event.latLng.lat(), longitude: event.latLng.lng() }));
      setStatus("ready");
    }).catch(() => setStatus("error"));
    return () => { cancelled = true; };
    // The map instance is intentionally created once; subsequent effects update its data and mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (mapRef.current) mapRef.current.setMapTypeId(mapType); }, [mapType]);

  useEffect(() => {
    if (status !== "ready" || !window.google?.maps || !mapRef.current) return;
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];
    const google = window.google;
    const bounds = new google.maps.LatLngBounds();
    if (site?.polygon?.length >= 3) {
      const path = site.polygon.map((point) => ({ lat: Number(point.latitude), lng: Number(point.longitude) }));
      path.forEach((point) => bounds.extend(point));
      const boundary = new google.maps.Polygon({ map: mapRef.current, paths: path, strokeColor: "#1976ff", strokeWeight: 3, fillColor: "#1976ff", fillOpacity: .06, clickable: false, zIndex: 2 });
      overlaysRef.current.push(boundary);
    }
    const temperatures = heatFeatures.map((feature) => Number(feature?.properties?.temperature)).filter(Number.isFinite);
    const minimum = temperatures.length ? Math.min(...temperatures) : 0;
    const maximum = temperatures.length ? Math.max(...temperatures) : 0;
    if (heatVisible) heatFeatures.forEach((feature) => {
      const ring = feature?.geometry?.coordinates?.[0];
      if (!Array.isArray(ring)) return;
      const temperature = Number(feature?.properties?.temperature);
      const polygon = new google.maps.Polygon({ map: mapRef.current, paths: ring.map(([lng, lat]) => ({ lat, lng })), strokeOpacity: 0, fillColor: heatColor(temperature, minimum, maximum), fillOpacity: .5, clickable: false, zIndex: 1 });
      overlaysRef.current.push(polygon);
    });
    crew.forEach((worker, index) => {
      if (!worker.position) return;
      const marker = new google.maps.Marker({ map: mapRef.current, position: { lat: Number(worker.position.latitude), lng: Number(worker.position.longitude) }, label: { text: worker.name || worker.workerId, color: "#172033", fontWeight: "700", fontSize: "11px", className: "hs-google-worker-label" }, title: `${worker.workerId} · ${worker.currentTask}`, draggable: true, zIndex: selectedWorkerId === worker.workerId ? 20 : 10 + index });
      marker.addListener("click", () => onSelectWorker?.(worker.workerId));
      marker.addListener("dragend", (event) => onWorkerMove?.(worker.workerId, { latitude: event.latLng.lat(), longitude: event.latLng.lng() }));
      overlaysRef.current.push(marker);
    });
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 50);
    // Event callbacks are rebound whenever the rendered map data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crew, heatFeatures, heatVisible, selectedWorkerId, site, status]);

  return <div className="hs-google-map-shell"><div ref={nodeRef} className="hs-google-map" />{status === "loading" ? <div className="hs-map-cover"><LoaderCircle className="spinner"/> Loading Google Maps…</div> : null}{status === "error" ? <div className="hs-map-cover error"><MapPinned/>Google Maps unavailable. Check VITE_MAP and API restrictions.</div> : null}</div>;
}
