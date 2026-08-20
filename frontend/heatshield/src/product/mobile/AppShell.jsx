import { useEffect, useState } from "react";
import {
  BatteryFull,
  Bell,
  ChevronDown,
  ClipboardList,
  Home,
  MapPinned,
  Settings,
  Signal,
  Users,
  Wifi,
  X,
} from "lucide-react";

const TABS = [
  ["today", "Today", Home],
  ["map", "Map", MapPinned],
  ["plan", "Plan", ClipboardList],
  ["team", "Team", Users],
  ["alerts", "Alerts", Bell],
];

function BrandMark() {
  return (
    <svg viewBox="0 0 64 72" role="img" aria-label="HeatShield">
      <defs>
        <linearGradient id="hsBrandShieldGradient" x1="10" y1="9" x2="55" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffb33f" />
          <stop offset="0.42" stopColor="#ff7b28" />
          <stop offset="1" stopColor="#ef4737" />
        </linearGradient>
      </defs>

      <path
        d="M32 3.5 55.5 10v19.2c0 17.1-9.2 31.2-23.5 39.1C17.7 60.4 8.5 46.3 8.5 29.2V10L32 3.5Z"
        fill="url(#hsBrandShieldGradient)"
        stroke="white"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <path
        d="M32 8.2 51.2 13.5v15.2c0 14.7-7.4 27-19.2 34.2-11.8-7.2-19.2-19.5-19.2-34.2V13.5L32 8.2Z"
        fill="none"
        stroke="rgba(255,255,255,.32)"
        strokeWidth="1"
      />

      <g fill="none" stroke="white" strokeWidth="2.35" strokeLinecap="round">
        <circle cx="32" cy="31" r="7.5" />
        <path d="M32 17.3v5" />
        <path d="M32 39.7v5" />
        <path d="M18.3 31h5" />
        <path d="M40.7 31h5" />
        <path d="m22.3 21.3 3.5 3.5" />
        <path d="m38.2 37.2 3.5 3.5" />
        <path d="m41.7 21.3-3.5 3.5" />
        <path d="m25.8 37.2-3.5 3.5" />
      </g>
      <circle cx="32" cy="31" r="3.7" fill="white" opacity=".96" />
    </svg>
  );
}

function Brand() {
  return (
    <div className="hs-brand">
      <span className="hs-brand-mark"><BrandMark /></span>
      <strong>
        <span className="hs-brand-heat">Heat</span>
        <span className="hs-brand-shield">Shield</span>
      </strong>
    </div>
  );
}

function useStatusTime() {
  const makeTime = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const [time, setTime] = useState(makeTime);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(makeTime()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return time;
}

export default function AppShell({
  children,
  activeTab,
  onNavigate,
  location,
  cycle,
  message,
  error,
  onDismissMessage,
  onDismissError,
}) {
  const statusTime = useStatusTime();
  const locationName = location?.name || location?.city || "Selected worksite";

  return (
    <div className="hs-page">
      <div className="hs-app-frame">
        <header className="hs-header">
          <div className="hs-header-glow" />
          <div className="hs-phone-status" aria-hidden="true">
            <strong>{statusTime}</strong>
            <div><Signal size={16} /><Wifi size={17} /><BatteryFull size={20} /></div>
          </div>

          <div className="hs-header-row">
            <Brand />
            <div className="hs-header-actions">
              <button className="hs-icon-button" type="button" aria-label="Open alerts" onClick={() => onNavigate("alerts")}>
                <Bell size={21} />
                {cycle?.current_assessment?.screening?.band && cycle.current_assessment.screening.band !== "below_caution" ? <span className="hs-notification-dot" /> : null}
              </button>
              <button className="hs-icon-button" type="button" aria-label="Open preferences" onClick={() => onNavigate("alerts")}>
                <Settings size={21} />
              </button>
            </div>
          </div>

          <button className="hs-location-button" type="button" onClick={() => onNavigate("map")}>
            <MapPinned size={22} />
            <span>{locationName}</span>
            <ChevronDown size={20} />
          </button>
        </header>

        <main className="hs-content">
          {error ? (
            <div className="hs-toast hs-toast-error">
              <span>{error}</span>
              <button type="button" onClick={onDismissError} aria-label="Dismiss error"><X size={16} /></button>
            </div>
          ) : null}
          {message ? (
            <div className="hs-toast hs-toast-success">
              <span>{message}</span>
              <button type="button" onClick={onDismissMessage} aria-label="Dismiss message"><X size={16} /></button>
            </div>
          ) : null}
          {children}
        </main>

        <nav className="hs-bottom-nav" aria-label="HeatShield navigation">
          {TABS.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              className={activeTab === id ? "active" : ""}
              onClick={() => onNavigate(id)}
            >
              <Icon size={23} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
