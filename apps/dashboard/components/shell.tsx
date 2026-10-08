import { getDashboardDataSource } from "../data";
import { LiveStatus } from "./live-status";
import Link from "next/link";
import type { ReactNode } from "react";

const nav = [
  ["/", "Início"],
  ["/missions", "Missões"],
  ["/opportunities", "Oportunidades"],
  ["/tasks", "Work"],
  ["/decisions", "Decisões"],
  ["/resources", "Recursos"],
  ["/memory", "Memória"],
  ["/audit", "Histórico"],
  ["/settings", "Configurações"]
] as const;

export async function DashboardShell({ children, provenance }: { children: ReactNode; provenance?: "local" | "mock" | "empty" }) {
  const developerMode = await getDashboardDataSource().isDeveloperMode();
  return (
    <div className={`shell${developerMode ? " developer-mode" : ""}`}>
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">B</div>
          <div>
            <div className="brand">BEYONDER</div>
            <div className="brand-subtitle">CONTROL CENTER</div>
          </div>
        </div>
        <nav className="nav" aria-label="Primary navigation">
          {nav.map(([href, label]) => (
            <Link key={href} href={href} className="nav-link">
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="scope-row"><span className="scope-dot" /> LOCAL ONLY</div>
          <div className="muted small">local · secrets redacted</div>
          {provenance === "mock" || process.env.BEYONDER_CONTROL_FIXTURE === "1" ? <div className="demo-badge">DEMO / TEST DATA</div> : null}
        </div>
      </aside>
      <main className="main"><LiveStatus />{children}</main>
    </div>
  );
}
