# HeatShield dashboard

Dark-mode urban heat intelligence dashboard built with React, Vite, React Leaflet, OpenStreetMap, and Recharts.

## Run locally

```bash
npm install
npm run dev
```

Run the FastAPI backend on `http://127.0.0.1:8000` first. Vite proxies relative `/api` requests to it, so provider credentials remain server-side and are never exposed to React.

Select **Analyze** to request the reproducible Phoenix provider snapshot through `POST /api/fortyguard/heatmap/result`. Use `npm run lint` and `npm run build` for validation.

## Heat-map data boundary

- `src/components/map/LiveHeatMap.jsx` owns the interactive Leaflet map, OpenStreetMap base layer, controls, markers, and popups.
- `src/components/map/FortyGuardHeatLayer.jsx` renders validated provider Polygon and MultiPolygon features, fits their bounds, and shows real tile properties.
- `src/components/map/MockHeatLayer.jsx` owns only the clearly labelled demo fallback overlay.
- `src/data/mockHeatData.js` supplies only the fallback GeoJSON `FeatureCollection`.
- `src/api/heatshieldApi.js` owns the backend request, response validation, AOI construction, and reusable environmental endpoint helper.

The live TCM layer styles `average_temperature` first and supports explicit legacy `temperature`. It deliberately does not interpret generic analysis-heatmap `value` fields as Celsius. Missing or invalid live geometry fails safely and leaves the mock layer visibly labelled **Demo Data**.

Environmental KPI cards are not connected in this iteration; the API helper exists, but no environmental provider job is submitted automatically.
