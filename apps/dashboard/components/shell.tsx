import Link from "next/link";
import type { ReactNode } from "react";

const nav = [
  ["/", "Overview", "01"],
  ["/economy", "Economy", "02"],
  ["/providers", "Providers", "03"],
  ["/intelligence", "Intelligence", "04"],
  ["/memory", "Memory", "05"],
  ["/tasks", "Tasks", "06"],
  ["/audit", "Audit", "07"]
] as const;

export function DashboardShell({ children, provenance }: { children: ReactNode; provenance?: "local" | "mock" | "empty" }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">B</div>
          <div>
            <div className="brand">BEYONDER</div>
            <div className="brand-subtitle">CONTROL PLANE</div>
          </div>
        </div>
        <nav className="nav" aria-label="Primary navigation">
          {nav.map(([href, label, index]) => (
            <Link key={href} href={href} className="nav-link">
              <span className="nav-index">{index}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="scope-row"><span className="scope-dot" /> LOCAL ONLY</div>
          <div className="muted small">read-only · secrets redacted</div>
          {provenance === "mock" ? <div className="demo-badge">DEMO DATA</div> : null}
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
