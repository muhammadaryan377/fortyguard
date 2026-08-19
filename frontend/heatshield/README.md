# HeatShield dashboard

Dark-mode urban heat intelligence dashboard built with React, Vite, React Leaflet, OpenStreetMap, and Recharts.

## Run locally

```bash
npm install
npm run dev
```

Use `npm run lint` and `npm run build` for validation.

## Heat-map data boundary

- `src/components/map/LiveHeatMap.jsx` owns the interactive Leaflet map, OpenStreetMap base layer, controls, markers, and popups.
- `src/components/map/MockHeatLayer.jsx` owns only the heat-overlay rendering pane.
- `src/data/mockHeatData.js` supplies the temporary GeoJSON `FeatureCollection`.

The mock properties mirror the FortyGuard TCM shape (`average_temperature`, `min_temperature`, and `max_temperature`). To connect live data later, pass the normalized FortyGuard `map_data` FeatureCollection into `MockHeatLayer` without replacing the base map or interaction shell.
