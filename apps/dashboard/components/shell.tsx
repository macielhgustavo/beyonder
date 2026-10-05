import { getDashboardDataSource } from "../data";
import { LiveStatus } from "./live-status";
import { Navigation } from "./navigation";
import type { ReactNode } from "react";

export async function DashboardShell({ children, provenance }: { children: ReactNode; provenance?: "local" | "mock" | "empty" }) {
  const developerMode = await getDashboardDataSource().isDeveloperMode();
  return (
    <div className={`shell${developerMode ? " developer-mode" : ""}`}>
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span>B</span></div>
          <div className="brand-copy">
            <div className="brand">BEYONDER</div>
            <div className="brand-subtitle">CONTROL CENTER</div>
          </div>
        </div>
        <Navigation />
        <div className="sidebar-foot">
          <div className="scope-row"><span className="scope-dot" /> LOCAL CONTROL PLANE</div>
          <div className="muted small">secrets redacted · operator surface</div>
          {provenance === "mock" || process.env.BEYONDER_CONTROL_FIXTURE === "1" ? <div className="demo-badge">DEMO / TEST DATA</div> : null}
        </div>
      </aside>
      <main className="main">
        <div className="control-topbar">
          <div className="control-context"><span className="control-context-dot" /><span>Control plane</span></div>
          <LiveStatus />
        </div>
        <div className="content-surface">{children}</div>
      </main>
    </div>
  );
}
