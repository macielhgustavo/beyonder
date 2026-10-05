import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, right }: { eyebrow?: string; title: string; description: string; right?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-heading">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {right ? <div className="header-right">{right}</div> : null}
    </header>
  );
}

export function Metric({ label, value, hint, tone = "neutral" }: { label: string; value: ReactNode; hint?: string; tone?: "good" | "warn" | "bad" | "neutral" | "info" }) {
  return (
    <div className={`metric metric-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value tone-${tone}`}>{value}</div>
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
      <div className="empty-signal" aria-hidden="true"><span /><span /><span /></div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function ProvenanceNotice({ provenance }: { provenance: "local" | "mock" | "empty" }) {
  if (provenance === "mock") {
    return <div className="provenance provenance-demo"><strong>DEMO / TEST DATA</strong><span>Dados de fixture para validacao visual e funcional. Nada aqui e apresentado como verdade do runtime.</span></div>;
  }
  if (provenance === "empty") {
    return <div className="provenance"><strong>SEM FONTE DE DADOS</strong><span>O Control Center esta aberto, mas ainda nao existe runtime conectado.</span></div>;
  }
  return <div className="provenance"><strong>LOCAL / REDACTED</strong><span>Dados lidos do armazenamento local do Beyonder. Campos sensiveis permanecem ocultos.</span></div>;
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
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
