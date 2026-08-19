import { useCallback, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  BrainCircuit,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Droplets,
  FileChartColumn,
  Flame,
  Grid2X2,
  Hexagon,
  History,
  Leaf,
  LoaderCircle,
  MapPinned,
  Search,
  Settings,
  Shield,
  SunMedium,
  ThermometerSun,
  Trees,
  Wind,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { fetchHeatmap } from "./api/heatshieldApi.js";
import LiveHeatMap from "./components/map/LiveHeatMap.jsx";
import "./App.css";

const navigation = [
  { label: "Dashboard", icon: Grid2X2, active: true },
  { label: "Map Analysis", icon: MapPinned },
  { label: "Risk Reports", icon: FileChartColumn },
  { label: "History", icon: History },
  { label: "Alerts", icon: Bell },
  { label: "Recommendations", icon: CheckCircle2 },
  { label: "Settings", icon: Settings },
];

const metrics = [
  {
    title: "Temperature",
    value: "33.1",
    unit: "°C",
    detail: "Surface Temp",
    icon: ThermometerSun,
    tone: "orange",
  },
  {
    title: "Heat Index",
    value: "34.6",
    unit: "°C",
    detail: "Feels Like",
    icon: SunMedium,
    tone: "amber",
  },
  {
    title: "Humidity",
    value: "42.7",
    unit: "%",
    detail: "Relative Humidity",
    icon: Droplets,
    tone: "cyan",
  },
  {
    title: "Wet Bulb Temp",
    value: "19.9",
    unit: "°C",
    detail: "Thermal Stress",
    icon: Wind,
    tone: "blue",
  },
];

const forecast = [
  { hour: 0, temperature: 23.6 },
  { hour: 2, temperature: 21.1 },
  { hour: 4, temperature: 19.4 },
  { hour: 6, temperature: 21.6 },
  { hour: 8, temperature: 25.2 },
  { hour: 10, temperature: 30.8 },
  { hour: 12, temperature: 34.7 },
  { hour: 14, temperature: 36.2 },
  { hour: 16, temperature: 35.1 },
  { hour: 18, temperature: 33.2 },
  { hour: 20, temperature: 29.7 },
  { hour: 22, temperature: 26.4 },
  { hour: 24, temperature: 23.8 },
];

const timeLabels = {
  0: "12 AM",
  4: "4 AM",
  8: "8 AM",
  12: "12 PM",
  16: "4 PM",
  20: "8 PM",
  24: "12 AM",
};

const recommendedActions = [
  {
    title: "Increase shade coverage in high exposure areas",
    description: "Prioritize trees and shade structures",
    icon: Trees,
    tone: "green",
  },
  {
    title: "Use reflective or cool roof materials",
    description: "Reduce heat absorption from buildings",
    icon: Building2,
    tone: "blue",
  },
  {
    title: "Schedule outdoor activities smartly",
    description: "Avoid peak heat hours (1 PM - 5 PM)",
    icon: Clock3,
    tone: "yellow",
  },
];

function Brand() {
  return (
    <div className="brand" aria-label="HeatShield Urban Heat Intelligence">
      <div className="brand-mark" aria-hidden="true">
        <Shield size={40} strokeWidth={1.8} />
        <Flame className="brand-flame" size={18} fill="currentColor" />
      </div>
      <div>
        <div className="brand-name">
          <span>Heat</span>Shield
        </div>
        <div className="brand-subtitle">Urban Heat Intelligence</div>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <Brand />

      <nav className="sidebar-nav" aria-label="Primary navigation">
        {navigation.map(({ label, icon: Icon, active }) => (
          <button
            className={`nav-item ${active ? "active" : ""}`}
            key={label}
            type="button"
            aria-current={active ? "page" : undefined}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="provider-card">
          <div className="provider-icon" aria-hidden="true">
            <Hexagon size={31} />
            <span />
          </div>
          <div>
            <small>Powered by</small>
            <strong>FortyGuard</strong>
          </div>
        </div>

        <div className="system-card">
          <strong>System Status</strong>
          <div className="system-state">
            <span className="status-dot" />
            All Systems Operational
          </div>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ isAnalyzing, onAnalyze }) {
  const submitAnalysis = (event) => {
    event.preventDefault();
    onAnalyze();
  };

  return (
    <header className="topbar">
      <form className="search-shell" onSubmit={submitAnalysis}>
        <Search size={20} aria-hidden="true" />
        <input
          aria-label="Search location, address or coordinates"
          placeholder="Search location, address or coordinates..."
        />
        <button type="submit" className="analyze-button" disabled={isAnalyzing}>
          {isAnalyzing ? (
            <LoaderCircle className="analyze-spinner" size={17} aria-hidden="true" />
          ) : (
            <Search size={17} aria-hidden="true" />
          )}
          {isAnalyzing ? "Analyzing..." : "Analyze"}
        </button>
      </form>

      <div className="topbar-status">
        <SunMedium className="weather-icon" size={34} />
        <div className="weather-copy">
          <strong>33°C</strong>
          <span>Clear Sky</span>
        </div>
        <button className="avatar" type="button" aria-label="Open HeatShield user menu">
          HS
        </button>
        <ChevronDown className="avatar-chevron" size={17} />
      </div>
    </header>
  );
}

function RiskMetric() {
  return (
    <article className="metric-card risk-metric">
      <div className="metric-heading">Heat Risk Score</div>
      <div className="risk-value-row">
        <div className="metric-value risk-value">
          82 <span>/ 100</span>
        </div>
        <svg className="sparkline" viewBox="0 0 116 45" role="img" aria-label="Heat risk trend rising">
          <defs>
            <linearGradient id="sparkGlow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#ff3d2e" />
              <stop offset="1" stopColor="#ffb000" />
            </linearGradient>
          </defs>
          <path d="M2 39 L16 31 L27 34 L41 25 L56 24 L68 17 L84 18 L94 27 L103 12 L114 6" />
        </svg>
      </div>
      <div className="risk-status">
        <AlertTriangle size={15} />
        Extreme Caution
      </div>
    </article>
  );
}

function MetricCard({ title, value, unit, detail, icon: Icon, tone }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-copy">
        <div className="metric-heading">{title}</div>
        <div className="metric-value">
          {value}<span>{unit}</span>
        </div>
        <div className="metric-detail">{detail}</div>
      </div>
      <div className={`metric-icon icon-${tone}`} aria-hidden="true">
        <Icon size={27} strokeWidth={1.8} />
      </div>
    </article>
  );
}

function AiRiskAnalysis() {
  return (
    <section className="panel ai-panel">
      <div className="panel-title-row">
        <h2>AI Risk Analysis</h2>
        <div className="ai-icon" aria-hidden="true">
          <BrainCircuit size={26} />
        </div>
      </div>
      <div className="title-accent" />

      <p className="analysis-copy">
        This area experiences very high heat exposure due to dense built environment, low
        vegetation, and high heat-retaining surfaces.
      </p>

      <div className="drivers-card">
        <h3>Key Drivers</h3>
        <ul>
          <li>High surface temperature</li>
          <li>Low vegetation cover</li>
          <li>Urban heat island effect</li>
        </ul>
      </div>

      <div className="confidence-block">
        <div className="confidence-label">
          <span>Confidence</span>
          <strong>92%</strong>
        </div>
        <div className="confidence-track">
          <span />
        </div>
      </div>
    </section>
  );
}

function ForecastChart() {
  return (
    <section className="panel forecast-panel">
      <div className="panel-title-row forecast-title">
        <div>
          <h2>24-Hour Heat Forecast</h2>
          <p>Hourly surface temperature projection</p>
        </div>
        <div className="forecast-live-chip">
          <Activity size={14} />
          Live model
        </div>
      </div>

      <div className="chart-wrap">
        <div className="static-chart-tooltip">
          <strong>36.2°C</strong>
          <span>2:00 PM</span>
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={forecast} margin={{ top: 18, right: 8, left: -15, bottom: 0 }}>
            <defs>
              <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f03d24" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#f03d24" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="forecastStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ff8a00" />
                <stop offset="100%" stopColor="#ff3b30" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#263449" strokeDasharray="4 6" vertical={false} opacity={0.55} />
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, 24]}
              ticks={[0, 4, 8, 12, 16, 20, 24]}
              tickFormatter={(value) => timeLabels[value]}
              axisLine={{ stroke: "#334157" }}
              tickLine={false}
              tick={{ fill: "#a7b2c4", fontSize: 11 }}
            />
            <YAxis
              domain={[10, 40]}
              ticks={[10, 20, 30, 40]}
              tickFormatter={(value) => `${value}°C`}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#a7b2c4", fontSize: 11 }}
            />
            <ReferenceLine x={14} stroke="#ff9b67" strokeDasharray="4 4" opacity={0.8} />
            <ReferenceDot x={14} y={36.2} r={5} fill="#ffb000" stroke="#fff" strokeWidth={2} />
            <Area
              type="monotone"
              dataKey="temperature"
              stroke="url(#forecastStroke)"
              strokeWidth={3}
              fill="url(#forecastFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function RecommendedActions() {
  return (
    <section className="panel actions-panel">
      <div className="panel-title-row actions-title">
        <div className="title-with-icon">
          <Leaf className="actions-leaf" size={20} />
          <h2>Recommended Actions</h2>
        </div>
        <span>3 prioritized</span>
      </div>

      <div className="action-list">
        {recommendedActions.map(({ title, description, icon: Icon, tone }, index) => (
          <button className="action-row" type="button" key={title}>
            <div className={`action-icon action-${tone}`}>
              <Icon size={20} />
            </div>
            <div className="action-copy">
              <strong>{title}</strong>
              <span>{description}</span>
            </div>
            <div className="action-index">0{index + 1}</div>
            <ArrowRight size={19} className="action-arrow" />
          </button>
        ))}
      </div>
    </section>
  );
}

function App() {
  const requestInFlight = useRef(false);
  const [heatmapState, setHeatmapState] = useState({
    phase: "demo",
    activityId: null,
    providerStatus: null,
    mapData: null,
    featureCount: 0,
    request: null,
    error: null,
  });

  const analyzePhoenix = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setHeatmapState({
      phase: "loading",
      activityId: null,
      providerStatus: null,
      mapData: null,
      featureCount: 0,
      request: null,
      error: null,
    });

    try {
      const result = await fetchHeatmap();
      setHeatmapState({
        phase: "live",
        activityId: result.activityId,
        providerStatus: result.status,
        mapData: result.mapData,
        featureCount: result.featureCount,
        request: result.request,
        error: null,
      });
    } catch (error) {
      setHeatmapState({
        phase: "error",
        activityId: null,
        providerStatus: null,
        mapData: null,
        featureCount: 0,
        request: null,
        error:
          error instanceof Error && error.message
            ? error.message
            : "Unable to load live heat intelligence.",
      });
    } finally {
      requestInFlight.current = false;
    }
  }, []);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="dashboard-main">
        <TopBar
          isAnalyzing={heatmapState.phase === "loading"}
          onAnalyze={analyzePhoenix}
        />

        <section className="metrics-grid" aria-label="Current heat metrics">
          <RiskMetric />
          {metrics.map((metric) => (
            <MetricCard {...metric} key={metric.title} />
          ))}
        </section>

        <div className="content-grid">
          <LiveHeatMap heatmapState={heatmapState} />
          <AiRiskAnalysis />
          <ForecastChart />
          <RecommendedActions />
        </div>
      </main>
    </div>
  );
}

export default App;
