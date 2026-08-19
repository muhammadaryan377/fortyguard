import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Droplets,
  FileChartColumn,
  Flame,
  Grid2X2,
  Hexagon,
  History,
  Leaf,
  LoaderCircle,
  MapPinned,
  Radar,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  SunMedium,
  ThermometerSun,
  Trees,
  Wind,
  Zap,
} from "lucide-react";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  deriveHeatIndexBand,
  fetchCyclePlan,
  fetchEnvironmentForHeatmap,
  fetchHeatmap,
  formatScreeningBand,
  getCurrentPhoenixDateTimeFilter,
  parseLocationInput,
  PHOENIX_LOCATION,
  VERIFIED_REPLAY_DATETIME,
  VERIFIED_SNAPSHOT_FILTER,
} from "./api/heatshieldApi.js";

import LiveHeatMap from "./components/map/LiveHeatMap.jsx";

import "./App.css";


const navigation = [
  {
    label: "Dashboard",
    icon: Grid2X2,
    active: true,
  },
  {
    label: "Map Analysis",
    icon: MapPinned,
  },
  {
    label: "Risk Reports",
    icon: FileChartColumn,
  },
  {
    label: "History",
    icon: History,
  },
  {
    label: "Alerts",
    icon: Bell,
  },
  {
    label: "Recommendations",
    icon: CheckCircle2,
  },
  {
    label: "Settings",
    icon: Settings,
  },
];


const actionNames = {
  cool_recovery:
    "Move to a cool recovery area",

  reduce_physical_demands:
    "Reduce physical workload",

  consider_cooler_sampled_period:
    "Consider a cooler sampled period",

  increase_monitoring:
    "Increase worker monitoring",

  limit_direct_sun:
    "Limit direct sun exposure",

  supervisor_review:
    "Request supervisor review",

  consider_cooler_zone:
    "Consider a cooler nearby zone",

  consider_shift_plan:
    "Consider optimized shift plan",
};


function numberOrNull(value) {
  return (
    typeof value ===
      "number" &&
    Number.isFinite(value)
      ? value
      : null
  );
}


function formatMetric(
  value,
  digits = 1,
) {
  const numeric =
    numberOrNull(value);

  return (
    numeric === null
      ? "--"
      : numeric.toFixed(
          digits,
        )
  );
}


function humanize(value) {
  if (!value) {
    return "Unavailable";
  }

  return String(value)
    .replaceAll(
      "_",
      " ",
    )
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase(),
    );
}


function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Shield
          size={39}
          strokeWidth={1.8}
        />

        <Flame
          className="brand-flame"
          size={18}
          fill="currentColor"
        />
      </div>

      <div>
        <div className="brand-name">
          <span>
            Heat
          </span>

          Shield
        </div>

        <div className="brand-subtitle">
          Urban Heat Intelligence
        </div>
      </div>
    </div>
  );
}


function Sidebar({
  systemState,
}) {
  const statusLabel =
    systemState ===
    "loading"
      ? "Analysis Running"

      : systemState ===
          "connected"
        ? "Live Pipeline Connected"

        : systemState ===
            "replay"
          ? "Historical Replay"

          : systemState ===
              "partial"
            ? "Partial Evidence"

            : systemState ===
                "error"
              ? "Needs Attention"

              : "Ready";

  return (
    <aside className="sidebar">
      <Brand />

      <nav className="sidebar-nav">
        {navigation.map(
          ({
            label,
            icon: Icon,
            active,
          }) => (
            <button
              type="button"
              key={label}
              className={
                `nav-item ${
                  active
                    ? "active"
                    : ""
                }`
              }
            >
              <Icon
                size={19}
                strokeWidth={1.8}
              />

              <span>
                {label}
              </span>

              {active ? (
                <ChevronRight
                  size={15}
                  className="nav-arrow"
                />
              ) : null}
            </button>
          ),
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="provider-card">
          <div className="provider-icon">
            <Hexagon
              size={30}
            />

            <span />
          </div>

          <div>
            <small>
              Powered by
            </small>

            <strong>
              FortyGuard
            </strong>
          </div>
        </div>

        <div className="agent-provider-card">
          <BrainCircuit
            size={19}
          />

          <div>
            <small>
              Decision agent
            </small>

            <strong>
              DeepSeek
            </strong>
          </div>
        </div>

        <div className="system-card">
          <strong>
            System Status
          </strong>

          <div
            className={
              `system-state system-${systemState}`
            }
          >
            <span className="status-dot" />

            {statusLabel}
          </div>
        </div>
      </div>
    </aside>
  );
}


function TopBar({
  value,
  onChange,
  onAnalyze,
  isAnalyzing,
  environment,
}) {
  const temperature =
    environment
      ?.temperature_c;

  return (
    <header className="topbar">
      <form
        className="search-shell"
        onSubmit={(
          event,
        ) => {
          event.preventDefault();

          onAnalyze();
        }}
      >
        <Search
          size={19}
        />

        <input
          value={value}
          onChange={(
            event,
          ) =>
            onChange(
              event.target.value,
            )
          }
          aria-label="Analyze Phoenix location or coordinates"
          placeholder="Phoenix or 33.4484, -112.0740"
        />

        <button
          type="submit"
          className="analyze-button"
          disabled={
            isAnalyzing
          }
        >
          {isAnalyzing ? (
            <LoaderCircle
              className="spinner"
              size={17}
            />
          ) : (
            <Zap
              size={17}
            />
          )}

          {isAnalyzing
            ? "Analyzing..."
            : "Analyze"}
        </button>
      </form>

      <div className="topbar-status">
        <div className="weather-orb">
          <SunMedium
            size={24}
          />
        </div>

        <div className="weather-copy">
          <strong>
            {formatMetric(
              temperature,
            )}

            {numberOrNull(
              temperature,
            ) !== null
              ? "°C"
              : ""}
          </strong>

          <span>
            Provider temperature
          </span>
        </div>

        <div className="avatar">
          HS
        </div>
      </div>
    </header>
  );
}


function MetricCard({
  title,
  value,
  unit,
  detail,
  icon: Icon,
  tone,
  provider = false,
}) {
  return (
    <article
      className={
        `metric-card metric-${tone}`
      }
    >
      <div className="metric-topline">
        <span className="metric-heading">
          {title}
        </span>

        {provider ? (
          <span className="provider-mini">
            FG
          </span>
        ) : null}
      </div>

      <div className="metric-body">
        <div>
          <div className="metric-value">
            {value}

            {value !==
            "--" ? (
              <span>
                {unit}
              </span>
            ) : null}
          </div>

          <div className="metric-detail">
            {detail}
          </div>
        </div>

        <div
          className={
            `metric-icon icon-${tone}`
          }
        >
          <Icon
            size={25}
          />
        </div>
      </div>
    </article>
  );
}


function RiskCard({
  assessment,
  environment,
  analysisMode,
}) {
  const backendScreening =
    assessment
      ?.screening;

  const fallbackBand =
    deriveHeatIndexBand(
      environment
        ?.heat_index_c,
    );

  const band =
    backendScreening
      ?.band ??
    fallbackBand;

  const riskScore =
    numberOrNull(
      assessment
        ?.risk_score,
    );

  const configurationText =
    assessment
      ? humanize(
          assessment
            .risk_level,
        )

      : environment
        ? "Provider evidence available"

        : "Awaiting analysis";

  return (
    <article className="metric-card risk-card">
      <div className="metric-topline">
        <span className="metric-heading">
          Heat Risk
        </span>

        <ShieldCheck
          size={18}
        />
      </div>

      <div className="risk-main">
        <div className="risk-score">
          {riskScore ===
          null
            ? "--"
            : Math.round(
                riskScore,
              )}

          <span>
            / 100
          </span>
        </div>

        <div className="risk-pulse">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="risk-band">
        <AlertTriangle
          size={14}
        />

        {band
          ? formatScreeningBand(
              band,
            )
          : "No screening yet"}
      </div>

      <div className="risk-config-note">
        Heat Index screening
        {" · "}
        {configurationText}

        {analysisMode ===
        "replay"
          ? " · Historical replay"
          : ""}
      </div>
    </article>
  );
}


function AnalysisProgress({
  environment,
  assessment,
  outlook,
  decision,
}) {
  const stages = [
    {
      label: "SENSE",
      complete:
        Boolean(
          environment,
        ),
    },
    {
      label: "ASSESS",
      complete:
        Boolean(
          assessment,
        ),
    },
    {
      label: "PREDICT",
      complete:
        Boolean(
          outlook,
        ),
    },
    {
      label: "DECIDE",
      complete:
        Boolean(
          decision,
        ) &&
        decision.status !==
          "agent_unavailable",
    },
  ];

  return (
    <div className="agent-flow">
      {stages.map(
        (
          stage,
          index,
        ) => (
          <div
            className="agent-flow-step"
            key={
              stage.label
            }
          >
            <span
              className={
                `flow-dot ${
                  stage.complete
                    ? "complete"
                    : ""
                }`
              }
            />

            <strong>
              {stage.label}
            </strong>

            {index <
            stages.length -
              1 ? (
              <i />
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}


function RiskAnalysisPanel({
  cycle,
  environment,
  analysisError,
  analysisMode,
}) {
  const assessment =
    cycle
      ?.current_assessment;

  const outlook =
    cycle
      ?.heat_outlook;

  const decision =
    cycle
      ?.agent_decision;

  const screening =
    assessment
      ?.screening;

  const explanations =
    assessment
      ?.explanations ??
    [];

  const factors =
    assessment
      ?.factors ??
    [];

  const isReplay =
    analysisMode ===
    "replay";

  let mainCopy =
    (
      "Run an analysis to load FortyGuard evidence "
      + "and start the HeatShield decision pipeline."
    );

  if (assessment) {
    mainCopy =
      explanations[0] ??
      (
        `HeatShield received ${assessment.data_quality} environmental `
        + "evidence and completed deterministic assessment."
      );
  } else if (environment) {
    mainCopy =
      (
        "FortyGuard provider evidence is available. "
        + "The complete agentic cycle was not completed, "
        + "so no AI decision is being claimed."
      );
  }

  if (
    isReplay &&
    assessment
  ) {
    mainCopy =
      (
        "Historical replay: all SENSE, ASSESS, PREDICT and DECIDE "
        + "stages are anchored to the same verified FortyGuard "
        + "historical analysis hour. "
        + mainCopy
      );
  }

  return (
    <section className="panel ai-panel">
      <div className="panel-title-row">
        <div>
          <div className="section-eyebrow">
            ASSESS + DECIDE
          </div>

          <h2>
            Agentic Risk Analysis
          </h2>
        </div>

        <div className="ai-icon">
          <BrainCircuit
            size={25}
          />
        </div>
      </div>

      <AnalysisProgress
        environment={
          environment
        }
        assessment={
          assessment
        }
        outlook={
          outlook
        }
        decision={
          decision
        }
      />

      <div className="analysis-summary">
        <div className="analysis-state-row">
          <span
            className={
              `decision-chip ${
                decision?.status ===
                "decided"
                  ? "decision-live"
                  : ""
              }`
            }
          >
            <Sparkles
              size={13}
            />

            {decision
              ? humanize(
                  decision.status,
                )

              : environment
                ? "Provider data only"

                : "Waiting"}
          </span>

          {isReplay ? (
            <span className="model-chip">
              Historical Replay
            </span>
          ) : null}

          {decision
            ?.model ? (
            <span className="model-chip">
              {decision.model}
            </span>
          ) : null}
        </div>

        <p>
          {mainCopy}
        </p>
      </div>

      <div className="analysis-grid">
        <div>
          <span>
            Data quality
          </span>

          <strong>
            {assessment
              ? humanize(
                  assessment
                    .data_quality,
                )

              : environment
                ? "Provider evidence"

                : "--"}
          </strong>
        </div>

        <div>
          <span>
            Heat screening
          </span>

          <strong>
            {screening
              ?.band
              ? formatScreeningBand(
                  screening.band,
                )

              : formatScreeningBand(
                  deriveHeatIndexBand(
                    environment
                      ?.heat_index_c,
                  ),
                )}
          </strong>
        </div>

        <div>
          <span>
            Forecast trend
          </span>

          <strong>
            {outlook
              ?.summary
              ?.trend
              ? humanize(
                  outlook
                    .summary
                    .trend,
                )

              : "--"}
          </strong>
        </div>

        <div>
          <span>
            Next step
          </span>

          <strong>
            {cycle
              ?.next_step
              ? humanize(
                  cycle
                    .next_step,
                )

              : "--"}
          </strong>
        </div>
      </div>

      {factors.length ? (
        <div className="drivers-card">
          <h3>
            Evidence Drivers
          </h3>

          {factors
            .slice(
              0,
              3,
            )
            .map(
              (
                factor,
                index,
              ) => (
                <div
                  className="driver-row"
                  key={
                    `${factor.factor}-${index}`
                  }
                >
                  <span className="driver-number">
                    0
                    {index + 1}
                  </span>

                  <div>
                    <strong>
                      {humanize(
                        factor.factor,
                      )}
                    </strong>

                    <span>
                      {factor.effect ??
                        String(
                          factor.value ??
                            "",
                        )}
                    </span>
                  </div>
                </div>
              ),
            )}
        </div>
      ) : null}

      {analysisError ? (
        <div className="inline-warning">
          <AlertTriangle
            size={16}
          />

          <span>
            {analysisError}
          </span>
        </div>
      ) : null}
    </section>
  );
}


function ForecastPanel({
  cycle,
  environment,
  analysisMode,
}) {
  const outlook =
    cycle
      ?.heat_outlook;

  const currentTemp =
    numberOrNull(
      environment
        ?.temperature_c,
    );

  const forecastData =
    useMemo(
      () => {
        const data = [];

        if (
          currentTemp !==
          null
        ) {
          data.push({
            offset: 0,
            temperature:
              currentTemp,
            label: "Now",
          });
        }

        for (
          const point
          of outlook?.points ??
            []
        ) {
          if (
            point.status ===
              "available" &&
            numberOrNull(
              point.temperature_c,
            ) !== null
          ) {
            data.push({
              offset:
                point.offset_hours,

              temperature:
                point.temperature_c,

              label:
                `+${point.offset_hours}h`,
            });
          }
        }

        return data;
      },
      [
        currentTemp,
        outlook,
      ],
    );

  return (
    <section className="panel forecast-panel">
      <div className="panel-title-row">
        <div>
          <div className="section-eyebrow">
            PREDICT
          </div>

          <h2>
            Provider Heat Outlook
          </h2>

          <p className="panel-subtitle">
            {analysisMode ===
            "replay"
              ? (
                "Historical FortyGuard sampled temperature points"
              )
              : (
                "FortyGuard sampled temperature points"
              )}
          </p>
        </div>

        <div
          className={
            `forecast-status ${
              outlook
                ? "forecast-active"
                : ""
            }`
          }
        >
          <Activity
            size={14}
          />

          {outlook
            ? humanize(
                outlook.status,
              )
            : "Not loaded"}
        </div>
      </div>

      {forecastData.length >=
      2 ? (
        <div className="chart-wrap">
          <ResponsiveContainer
            width="100%"
            height="100%"
          >
            <AreaChart
              data={
                forecastData
              }
              margin={{
                top: 18,
                right: 8,
                bottom: 0,
                left: -18,
              }}
            >
              <defs>
                <linearGradient
                  id="heatForecastFill"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor="#ff522e"
                    stopOpacity={
                      0.48
                    }
                  />

                  <stop
                    offset="100%"
                    stopColor="#ff522e"
                    stopOpacity={
                      0.02
                    }
                  />
                </linearGradient>

                <linearGradient
                  id="heatForecastStroke"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="0"
                >
                  <stop
                    offset="0%"
                    stopColor="#ffb020"
                  />

                  <stop
                    offset="100%"
                    stopColor="#ff3e35"
                  />
                </linearGradient>
              </defs>

              <CartesianGrid
                stroke="#263449"
                strokeDasharray="4 6"
                vertical={false}
                opacity={0.55}
              />

              <XAxis
                dataKey="offset"
                tickFormatter={(
                  value,
                ) =>
                  value === 0
                    ? "Now"
                    : `+${value}h`
                }
                tickLine={false}
                axisLine={{
                  stroke:
                    "#334157",
                }}
                tick={{
                  fill:
                    "#8797aa",
                  fontSize: 11,
                }}
              />

              <YAxis
                tickFormatter={(
                  value,
                ) =>
                  `${value}°`
                }
                tickLine={false}
                axisLine={false}
                width={50}
                tick={{
                  fill:
                    "#8797aa",
                  fontSize: 11,
                }}
                domain={[
                  "dataMin - 2",
                  "dataMax + 2",
                ]}
              />

              <ChartTooltip
                contentStyle={{
                  background:
                    "#081523",

                  border:
                    "1px solid #25384e",

                  borderRadius:
                    "10px",

                  color:
                    "#ffffff",
                }}
                formatter={(
                  value,
                ) => [
                  `${Number(
                    value,
                  ).toFixed(
                    1,
                  )}°C`,

                  "Temperature",
                ]}
                labelFormatter={(
                  value,
                ) =>
                  value === 0
                    ? "Analysis hour"
                    : `+${value} hours`
                }
              />

              <Area
                type="monotone"
                dataKey="temperature"
                stroke="url(#heatForecastStroke)"
                strokeWidth={3}
                fill="url(#heatForecastFill)"
                isAnimationActive
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="empty-panel-state">
          <Radar
            size={31}
          />

          <strong>
            Forecast not available
          </strong>

          <span>
            Run Analyze to
            request the backend
            PREDICT stage.
          </span>
        </div>
      )}

      {outlook
        ?.summary ? (
        <div className="forecast-summary">
          <div>
            <span>
              Highest sampled
            </span>

            <strong>
              {formatMetric(
                outlook
                  .summary
                  .highest_sampled_temperature_c,
              )}
              °C
            </strong>
          </div>

          <div>
            <span>
              Lowest sampled
            </span>

            <strong>
              {formatMetric(
                outlook
                  .summary
                  .lowest_sampled_temperature_c,
              )}
              °C
            </strong>
          </div>

          <div>
            <span>
              Available
            </span>

            <strong>
              {
                outlook
                  .summary
                  .available_points
              }
              /
              {
                outlook
                  .summary
                  .total_points
              }
            </strong>
          </div>
        </div>
      ) : null}
    </section>
  );
}


function RecommendationsPanel({
  cycle,
}) {
  const assessment =
    cycle
      ?.current_assessment;

  const decision =
    cycle
      ?.agent_decision;

  const aiActions =
    decision
      ?.actions ??
    [];

  const deterministicControls =
    assessment
      ?.screening
      ?.recommended_controls ??
    [];

  const rows =
    aiActions.length >
    0
      ? aiActions
          .slice(
            0,
            3,
          )
          .map(
            (
              action,
            ) => ({
              title:
                actionNames[
                  action
                    .action_type
                ] ??
                humanize(
                  action
                    .action_type,
                ),

              description:
                action
                  .reason_codes
                  ?.map(
                    humanize,
                  )
                  .join(
                    " · ",
                  ) ??
                "Agent-selected action",

              source:
                (
                  "DeepSeek + "
                  + "server validation"
                ),

              approval:
                action
                  .requires_human_approval,
            }),
          )

      : deterministicControls
          .slice(
            0,
            3,
          )
          .map(
            (
              control,
            ) => ({
              title:
                control,

              description:
                (
                  "Deterministic "
                  + "screening control"
                ),

              source:
                "HeatShield policy",

              approval:
                false,
            }),
          );

  return (
    <section className="panel actions-panel">
      <div className="panel-title-row">
        <div>
          <div className="section-eyebrow">
            ACT
          </div>

          <h2>
            Recommended Actions
          </h2>
        </div>

        <div className="action-source-chip">
          <Leaf
            size={14}
          />

          {aiActions.length
            ? "Agent selected"
            : "Policy backed"}
        </div>
      </div>

      {rows.length ? (
        <div className="action-list">
          {rows.map(
            (
              item,
              index,
            ) => (
              <div
                className="action-row"
                key={
                  `${item.title}-${index}`
                }
              >
                <div className="action-index">
                  0
                  {index + 1}
                </div>

                <div className="action-copy">
                  <strong>
                    {item.title}
                  </strong>

                  <span>
                    {item.description}
                  </span>

                  <small>
                    {item.source}

                    {item.approval
                      ? (
                        " · Human approval required"
                      )
                      : ""}
                  </small>
                </div>

                <ArrowRight
                  size={17}
                />
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="empty-panel-state action-empty">
          <Trees
            size={29}
          />

          <strong>
            No actions yet
          </strong>

          <span>
            HeatShield will show
            server-validated
            recommendations after
            analysis.
          </span>
        </div>
      )}

      {cycle
        ?.next_step ===
      "human_approval_required" ? (
        <div className="approval-banner">
          <ShieldCheck
            size={17}
          />

          <span>
            Agent actions are
            proposals only.
            Supervisor approval is
            required before ACT.
          </span>
        </div>
      ) : null}
    </section>
  );
}


function App() {
  const requestInFlight =
    useRef(false);

  const [
    searchValue,
    setSearchValue,
  ] = useState(
    "Phoenix, Arizona",
  );

  const [
    location,
    setLocation,
  ] = useState({
    ...PHOENIX_LOCATION,
  });

  const [
    analysisMode,
    setAnalysisMode,
  ] = useState(
    "idle",
  );

  const [
    heatmapState,
    setHeatmapState,
  ] = useState({
    phase: "idle",
    activityId: null,
    providerStatus: null,
    mapData: null,
    featureCount: 0,
    request: null,
    error: null,
    fallbackReason: null,
  });

  const [
    environmentState,
    setEnvironmentState,
  ] = useState({
    phase: "idle",
    data: null,
    error: null,
  });

  const [
    cycleState,
    setCycleState,
  ] = useState({
    phase: "idle",
    data: null,
    error: null,
  });

  const [
    globalError,
    setGlobalError,
  ] = useState(null);


  const environment =
    cycleState.data
      ?.current_assessment
      ?.environmental_evidence ??
    environmentState.data
      ?.condition ??
    null;


  const assessment =
    cycleState.data
      ?.current_assessment ??
    null;


  const isAnalyzing =
    heatmapState.phase ===
      "loading" ||
    cycleState.phase ===
      "loading";


  const systemState =
    isAnalyzing
      ? "loading"

      : analysisMode ===
          "replay" &&
        heatmapState.mapData
        ? "replay"

      : cycleState.data &&
        heatmapState.phase ===
          "live"
        ? "connected"

      : environment
        ? "partial"

      : globalError
        ? "error"

      : "idle";


  const applyAttempt =
    useCallback(
      (
        attempt,
        mode,
        fallbackReason = null,
      ) => {
        const {
          heatmap,
          environmentResult,
          cycleResult,
        } = attempt;

        setAnalysisMode(
          mode,
        );

        setHeatmapState({
          phase:
            mode ===
            "live"
              ? "live"
              : "replay",

          activityId:
            heatmap.activityId,

          providerStatus:
            heatmap.status,

          mapData:
            heatmap.mapData,

          featureCount:
            heatmap.featureCount,

          request:
            heatmap.request,

          error: null,

          fallbackReason,
        });

        if (
          environmentResult.status ===
          "fulfilled"
        ) {
          setEnvironmentState({
            phase:
              "available",

            data:
              environmentResult.value,

            error: null,
          });
        } else {
          setEnvironmentState({
            phase:
              "error",

            data: null,

            error:
              environmentResult
                .reason
                ?.message ??
              (
                "Environmental evidence "
                + "was unavailable."
              ),
          });
        }

        if (
          cycleResult.status ===
          "fulfilled"
        ) {
          setCycleState({
            phase:
              "available",

            data:
              cycleResult.value,

            error: null,
          });
        } else {
          setCycleState({
            phase:
              "error",

            data: null,

            error:
              cycleResult
                .reason
                ?.message ??
              (
                "The HeatShield agentic "
                + "cycle was unavailable."
              ),
          });
        }
      },
      [],
    );


  const runAnalysis =
    useCallback(
      async () => {
        if (
          requestInFlight
            .current
        ) {
          return;
        }

        let selectedLocation;

        try {
          selectedLocation =
            parseLocationInput(
              searchValue,
            );

        } catch (error) {
          setGlobalError(
            error.message,
          );

          return;
        }

        requestInFlight.current =
          true;

        setGlobalError(
          null,
        );

        setLocation(
          selectedLocation,
        );

        setAnalysisMode(
          "loading",
        );

        setHeatmapState({
          phase:
            "loading",

          activityId:
            null,

          providerStatus:
            null,

          mapData:
            null,

          featureCount:
            0,

          request:
            null,

          error:
            null,

          fallbackReason:
            null,
        });

        setEnvironmentState({
          phase:
            "loading",

          data:
            null,

          error:
            null,
        });

        setCycleState({
          phase:
            "loading",

          data:
            null,

          error:
            null,
        });


        async function analyzeAt({
          dateTime,
          analysisDatetime,
        }) {
          const heatmap =
            await fetchHeatmap({
              latitude:
                selectedLocation
                  .latitude,

              longitude:
                selectedLocation
                  .longitude,

              dateTime,

              radiusMeters:
                300,

              granularity:
                100,
            });

          const [
            environmentResult,
            cycleResult,
          ] =
            await Promise.allSettled(
              [
                fetchEnvironmentForHeatmap(
                  heatmap,
                  selectedLocation,
                ),

                fetchCyclePlan(
                  selectedLocation,
                  {
                    analysisDatetime,
                  },
                ),
              ],
            );

          return {
            heatmap,
            environmentResult,
            cycleResult,
          };
        }


        let currentAttempt =
          null;

        let currentFailure =
          null;

        try {
          const currentFilter =
            getCurrentPhoenixDateTimeFilter();

          currentAttempt =
            await analyzeAt({
              dateTime:
                currentFilter,

              analysisDatetime:
                null,
            });

          const currentComplete =
            currentAttempt
              .environmentResult
              .status ===
              "fulfilled" &&
            currentAttempt
              .cycleResult
              .status ===
              "fulfilled";

          if (
            currentComplete
          ) {
            applyAttempt(
              currentAttempt,
              "live",
            );

            return;
          }

          currentFailure =
            currentAttempt
              .cycleResult
              .status ===
              "rejected"
              ? currentAttempt
                  .cycleResult
                  .reason
                  ?.message

              : currentAttempt
                  .environmentResult
                  .status ===
                  "rejected"
                ? currentAttempt
                    .environmentResult
                    .reason
                    ?.message

                : (
                  "Current provider pipeline "
                  + "did not complete."
                );

        } catch (error) {
          currentFailure =
            error?.message ??
            (
              "Current provider evidence "
              + "was unavailable."
            );
        }


        try {
          const replayAttempt =
            await analyzeAt({
              dateTime:
                VERIFIED_SNAPSHOT_FILTER,

              analysisDatetime:
                VERIFIED_REPLAY_DATETIME,
            });

          applyAttempt(
            replayAttempt,
            "replay",
            currentFailure,
          );

          if (
            replayAttempt
              .cycleResult
              .status ===
              "rejected"
          ) {
            setGlobalError(
              (
                "Historical provider evidence loaded, "
                + "but the complete agentic cycle did not finish."
              ),
            );
          }

          return;

        } catch (replayError) {
          if (
            currentAttempt
          ) {
            applyAttempt(
              currentAttempt,
              "live",
            );

            setGlobalError(
              (
                "Current provider map was available, "
                + "but the complete current pipeline failed "
                + "and the historical replay also failed."
              ),
            );

            return;
          }

          setAnalysisMode(
            "error",
          );

          setHeatmapState({
            phase:
              "error",

            activityId:
              null,

            providerStatus:
              null,

            mapData:
              null,

            featureCount:
              0,

            request:
              null,

            error:
              replayError
                ?.message ??
              (
                "Unable to load "
                + "FortyGuard heat intelligence."
              ),

            fallbackReason:
              currentFailure,
          });

          setEnvironmentState({
            phase:
              "error",

            data:
              null,

            error:
              replayError
                ?.message ??
              (
                "Environmental evidence "
                + "was unavailable."
              ),
          });

          setCycleState({
            phase:
              "error",

            data:
              null,

            error:
              replayError
                ?.message ??
              (
                "HeatShield cycle "
                + "was unavailable."
              ),
          });

          setGlobalError(
            (
              "HeatShield could not obtain either "
              + "a complete current analysis or the "
              + "verified historical replay."
            ),
          );

        } finally {
          requestInFlight.current =
            false;
        }
      },
      [
        searchValue,
        applyAttempt,
      ],
    );


  const metricCards = [
    {
      title:
        "Temperature",

      value:
        formatMetric(
          environment
            ?.temperature_c,
        ),

      unit:
        "°C",

      detail:
        (
          analysisMode ===
          "replay"
            ? "Historical provider temperature"
            : "Provider temperature"
        ),

      icon:
        ThermometerSun,

      tone:
        "orange",
    },

    {
      title:
        "Heat Index",

      value:
        formatMetric(
          environment
            ?.heat_index_c,
        ),

      unit:
        "°C",

      detail:
        "Provider heat index",

      icon:
        SunMedium,

      tone:
        "amber",
    },

    {
      title:
        "Humidity",

      value:
        formatMetric(
          environment
            ?.relative_humidity,
        ),

      unit:
        "%",

      detail:
        "Relative humidity",

      icon:
        Droplets,

      tone:
        "cyan",
    },

    {
      title:
        "Wet Bulb Temp",

      value:
        formatMetric(
          environment
            ?.wet_bulb_temperature_c,
        ),

      unit:
        "°C",

      detail:
        "Wet bulb — not WBGT",

      icon:
        Wind,

      tone:
        "blue",
    },
  ];


  return (
    <div className="app-shell">
      <Sidebar
        systemState={
          systemState
        }
      />

      <main className="dashboard-main">
        <TopBar
          value={
            searchValue
          }
          onChange={
            setSearchValue
          }
          onAnalyze={
            runAnalysis
          }
          isAnalyzing={
            isAnalyzing
          }
          environment={
            environment
          }
        />

        <div className="dashboard-heading">
          <div>
            <div className="section-eyebrow">
              HEATSHIELD COMMAND CENTER
            </div>

            <h1>
              Urban Heat Intelligence
            </h1>

            <p>
              FortyGuard provider
              evidence → deterministic
              risk assessment →
              sampled heat outlook →
              constrained DeepSeek
              decision.
            </p>
          </div>

          <div className="location-summary">
            <MapPinned
              size={18}
            />

            <div>
              <strong>
                {location.name}
              </strong>

              <span>
                {location.latitude.toFixed(
                  4,
                )}
                ,{" "}
                {location.longitude.toFixed(
                  4,
                )}

                {analysisMode ===
                "replay"
                  ? " · Historical Replay"
                  : ""}
              </span>
            </div>
          </div>
        </div>

        {globalError ? (
          <div className="global-error">
            <AlertTriangle
              size={17}
            />

            <span>
              {globalError}
            </span>
          </div>
        ) : null}

        <section className="metrics-grid">
          <RiskCard
            assessment={
              assessment
            }
            environment={
              environment
            }
            analysisMode={
              analysisMode
            }
          />

          {metricCards.map(
            (
              metric,
            ) => (
              <MetricCard
                key={
                  metric.title
                }
                {...metric}
                provider={
                  Boolean(
                    environment,
                  )
                }
              />
            ),
          )}
        </section>

        <section className="content-grid">
          <LiveHeatMap
            heatmapState={
              heatmapState
            }
            location={
              location
            }
          />

          <RiskAnalysisPanel
            cycle={
              cycleState.data
            }
            environment={
              environment
            }
            analysisError={
              cycleState.error
            }
            analysisMode={
              analysisMode
            }
          />

          <ForecastPanel
            cycle={
              cycleState.data
            }
            environment={
              environment
            }
            analysisMode={
              analysisMode
            }
          />

          <RecommendationsPanel
            cycle={
              cycleState.data
            }
          />
        </section>

        <footer className="dashboard-footer">
          <div>
            <Shield
              size={15}
            />

            HeatShield decision
            support — human approval
            required for operational
            actions.
          </div>

          <div>
            FortyGuard evidence ·
            HeatShield deterministic
            validation · DeepSeek
            constrained tool selection
          </div>
        </footer>
      </main>
    </div>
  );
}


export default App;