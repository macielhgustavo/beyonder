import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, right }: { eyebrow?: string; title: string; description: string; right?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {right ? <div className="header-right">{right}</div> : null}
    </header>
  );
}

export function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "good" | "warn" | "bad" | "neutral" | "info" }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone ? `tone-${tone}` : ""}`}>{value}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

export function Panel({ title, meta, children, className = "" }: { title: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2>{title}</h2>
        {meta ? <div className="panel-meta">{meta}</div> : null}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function StatusBadge({ children, status = "neutral" }: { children: ReactNode; status?: "good" | "warn" | "bad" | "neutral" | "info" }) {
  return <span className={`status status-${status}`}>{children}</span>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <div className="empty-line" />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function ProvenanceNotice({ provenance }: { provenance: "local" | "mock" | "empty" }) {
  if (provenance === "mock") {
    return <div className="provenance provenance-demo"><strong>DEMO DATA</strong><span>Visual fixture only. Nothing on this screen is presented as runtime truth.</span></div>;
  }
  if (provenance === "empty") {
    return <div className="provenance"><strong>NO DATA SOURCE</strong><span>The control plane is running without a connected runtime source.</span></div>;
  }
  return <div className="provenance"><strong>LOCAL READ-ONLY</strong><span>Data is read from the local Beyonder SQLite store. Sensitive fields are redacted.</span></div>;
}

export function formatUsd(value: number | null) {
  return value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

export function formatDuration(value: number | null) {
  if (value == null) return "—";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

export function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
