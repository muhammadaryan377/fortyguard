import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import ProductApp from "./ProductApp.jsx";
import AgricultureOverview from "./agriculture/AgricultureOverview.jsx";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const showAgriculture =
  window.location.pathname.startsWith("/agriculture") ||
  params.get("module") === "agriculture";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {showAgriculture ? <AgricultureOverview /> : <ProductApp />}
  </StrictMode>
);
