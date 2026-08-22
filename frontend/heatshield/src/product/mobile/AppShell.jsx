import { useState } from "react";
import { AlertTriangle, Bell, CalendarDays, ChevronLeft, ChevronRight, CircleHelp, FileText, MapPinned, RefreshCw, Settings, Shield, Users, X } from "lucide-react";

const TABS = [["today", "Today", Shield], ["map", "Map", MapPinned], ["plan", "Plan", CalendarDays], ["team", "Team", Users], ["alerts", "Alerts", Bell]];
function BrandMark() { return <svg viewBox="0 0 40 44" aria-hidden="true"><path d="M20 2 36 7v12c0 11-6.3 19.1-16 23C10.3 38.1 4 30 4 19V7l16-5Z" fill="none" stroke="currentColor" strokeWidth="2.5"/><path d="M20 10v19m-5-10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }

export default function AppShell({ children, activeTab, onNavigate, cycle, message, error, onDismissMessage, onDismissError, onRefresh, analysisBusy, operationBusy }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const navActive = ["site-setup", "crew-setup"].includes(activeTab) ? "plan" : activeTab;
  const alert = cycle?.current_assessment?.screening?.band && cycle.current_assessment.screening.band !== "below_caution";
  const busy = analysisBusy || operationBusy === "recheck";
  const title = TABS.find(([id]) => id === navActive)?.[1] || "HeatShield";
  return <div className="hs-page"><div className={`hs-app-frame hs-desktop-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    <aside className="hs-sidebar">
      <div className="hs-sidebar-brand"><BrandMark/><strong>HeatShield</strong></div>
      <nav aria-label="Primary navigation">{TABS.map(([id,label,Icon]) => <button key={id} type="button" className={navActive === id ? "active" : ""} onClick={() => onNavigate(id)}><Icon/><span>{label}</span></button>)}<button type="button"><FileText/><span>Reports</span></button><button type="button"><Settings/><span>Settings</span></button></nav>
      <div className="hs-sidebar-footer"><button type="button"><CircleHelp/><span>Help</span></button><button type="button"><ChevronLeft/><span>Collapse</span></button></div>
    </aside>
    <div className="hs-shell-main">
      <header className="hs-header hs-reference-header"><button className="hs-collapse-control" type="button" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <ChevronRight/> : <ChevronLeft/>}</button><strong className="hs-page-name">{title}</strong><div className="hs-reference-actions"><button className="hs-header-control" type="button" aria-label="Open alerts" onClick={() => onNavigate("alerts")}><Bell/>{alert ? <span className="hs-notification-dot">!</span> : null}</button><button className={`hs-header-control ${busy ? "busy" : ""}`} type="button" aria-label="Refresh heat analysis" onClick={onRefresh} disabled={busy}><RefreshCw/></button>{activeTab === "map" ? <button className="hs-create-plan-button" type="button" onClick={() => onNavigate("plan")}><FileText/>Create Plan</button> : null}<span className="hs-user-avatar">SP</span><span className="hs-user-role">Site Planner</span><ChevronRight className="hs-user-chevron"/></div></header>
      <main className="hs-content">{error ? <div className="hs-toast hs-toast-error"><AlertTriangle/><span>{error}</span><button type="button" onClick={onDismissError} aria-label="Dismiss error"><X/></button></div> : null}{message ? <div className="hs-toast hs-toast-success"><span>{message}</span><button type="button" onClick={onDismissMessage} aria-label="Dismiss message"><X/></button></div> : null}{children}</main>
      <nav className="hs-bottom-nav" aria-label="HeatShield navigation">{TABS.map(([id,label,Icon]) => <button key={id} type="button" className={navActive === id ? "active" : ""} onClick={() => onNavigate(id)}><Icon/><span>{label}</span></button>)}</nav>
    </div>
  </div></div>;
}
