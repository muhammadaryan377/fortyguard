import {
  Bell,
  ClipboardList,
  Flame,
  Home,
  MapPinned,
  Shield,
  Users,
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
      <span className="hs-brand-mark"><Shield size={28} /><Flame size={13} /></span>
      <strong><span>Heat</span>Shield</strong>
    </div>
  );
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
  return (
    <div className="hs-page">
      <div className="hs-app-frame">
        <header className="hs-header">
          <div className="hs-header-glow" />
          <div className="hs-header-row">
            <Brand />
            <button className="hs-icon-button" type="button" aria-label="Open alerts" onClick={() => onNavigate("alerts")}>
              <Bell size={20} />
              {cycle?.current_assessment?.screening?.band && cycle.current_assessment.screening.band !== "below_caution" ? <span className="hs-notification-dot" /> : null}
            </button>
          </div>
          <button className="hs-location-button" type="button" onClick={() => onNavigate("map")}>
            <MapPinned size={18} />
            <span>{location?.name || location?.city || "Selected worksite"}</span>
            <small>{location?.city}, {location?.state}</small>
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
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
