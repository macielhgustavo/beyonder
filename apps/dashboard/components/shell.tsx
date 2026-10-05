import { getDashboardDataSource } from "../data";
import { LiveStatus } from "./live-status";
import { PrimaryNavigation } from "./navigation";
import type { ReactNode } from "react";

export async function DashboardShell({ children, provenance }: { children: ReactNode; provenance?: "local" | "mock" | "empty" }) {
  const developerMode = await getDashboardDataSource().isDeveloperMode();
  const demo = provenance === "mock" || process.env.BEYONDER_CONTROL_FIXTURE === "1";

  return (
    <div className={`shell${developerMode ? " developer-mode" : ""}`}>
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="brand-copy">
            <div className="brand">BEYONDER</div>
            <div className="brand-subtitle">CONTROL PLANE</div>
          </div>
        </div>

        <div className="nav-kicker">OPERACOES</div>
        <PrimaryNavigation />

        <div className="sidebar-foot">
          <div className="scope-card">
            <div className="scope-row"><span className="scope-dot" /> LOCAL RUNTIME</div>
            <div className="scope-copy">Execucao e dados permanecem nesta maquina.</div>
            <div className="scope-meta">127.0.0.1 · secrets redacted</div>
          </div>
          {demo ? <div className="demo-badge">DEMO / TEST DATA</div> : null}
        </div>
      </aside>

      <main className="main">
        <div className="runtime-bar">
          <LiveStatus />
          <div className="runtime-context" aria-hidden="true">
            <span>CONTROL PLANE</span>
            <span>LOCAL / 4187</span>
          </div>
        </div>
        <div className="main-content">{children}</div>
      </main>
    </div>
  );
}
