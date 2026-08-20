import { useEffect, useState } from "react";
import {
  BatteryFull,
  Bell,
  ChevronDown,
  ClipboardList,
  Flame,
  Home,
  MapPinned,
  Settings,
  Shield,
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

function Brand() {
  return (
    <div className="hs-brand">
      <span className="hs-brand-mark"><Shield size={29} /><Flame size={13} /></span>
      <strong><span>Heat</span>Shield</strong>
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
