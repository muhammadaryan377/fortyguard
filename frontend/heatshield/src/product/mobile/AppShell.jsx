import { useEffect, useState } from "react";
import {
  Bell,
  ChevronDown,
  ClipboardList,
  Home,
  MapPin,
  MapPinned,
  UserRoundCheck,
  Users,
  X,
} from "lucide-react";

const TABS = [
  ["today", "Today", Home],
  ["plan", "Plan", ClipboardList],
  ["map", "Map", MapPinned],
  ["checkin", "Check-in", UserRoundCheck],
  ["team", "Team", Users],
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

function formatLocalDateTime(location, now) {
  const timezone = location?.timezone || undefined;
  try {
    return {
      time: new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
      }).format(now),
      date: new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(now),
    };
  } catch {
    return {
      time: new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(now),
      date: new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(now),
    };
  }
}

function useLocationClock(location) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return formatLocalDateTime(location, now);
}

export default function AppShell({
  children,
  activeTab,
  onNavigate,
  location,
  locationBusy,
  cycle,
  message,
  error,
  onDismissMessage,
  onDismissError,
}) {
  const clock = useLocationClock(location);
  const rawLocationName =
    location?.site_name ||
    location?.name ||
    location?.city ||
    (locationBusy ? "Finding your location…" : "Select worksite");
  const locationName = rawLocationName === "Phoenix Central City" ? "Phoenix Yard" : rawLocationName;

  return (
    <div className="hs-page">
      <div className="hs-app-frame">
        <header className="hs-header">
          <div className="hs-header-row">
            <Brand />
            <button
              className="hs-icon-button"
              type="button"
              aria-label="Open alerts"
              onClick={() => onNavigate("alerts")}
            >
              <Bell size={20} />
              {cycle?.current_assessment?.screening?.band && cycle.current_assessment.screening.band !== "below_caution" ? (
                <span className="hs-notification-dot" />
              ) : null}
            </button>
          </div>

          <button className="hs-location-button" type="button" onClick={() => onNavigate("map")}>
            <MapPin size={16} />
            <span>{locationName}</span>
            <ChevronDown size={16} />
          </button>
          <div className="hs-location-meta">
            {locationBusy && !location ? "Detecting current location…" : `${clock.time}  •  ${clock.date}`}
          </div>
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
