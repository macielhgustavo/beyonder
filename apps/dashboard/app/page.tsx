import { DashboardShell } from "../components/shell";
import { ModelDecisionInspector } from "../components/model-decision-inspector";
import { EmptyState, Metric, PageHeader, Panel, ProvenanceNotice, StatusBadge, formatPercent, formatTime, formatUsd } from "../components/ui";
import { getDashboardDataSource } from "../data";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const source = getDashboardDataSource();
  const [overview, providers] = await Promise.all([source.getOverview(), source.getProviders({ limit: 8 })]);
  const decision = overview.recentDecisions[0];
  const statusTone = overview.runtimeStatus === "online" ? "good" : overview.runtimeStatus === "degraded" ? "warn" : "bad";

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader
        eyebrow="RUNTIME / OVERVIEW"
        title="Beyonder"
        description="A read-only operational view across economy, intelligence, memory and execution."
        right={<StatusBadge status={statusTone}>{overview.runtimeStatus.toUpperCase()}</StatusBadge>}
      />
      <ProvenanceNotice provenance={source.provenance} />
      <section className="metric-strip">
        <Metric label="Economic state" value={overview.economicState.toUpperCase()} tone={overview.economicState === "survival" || overview.economicState === "halted" ? "warn" : "neutral"} />
        <Metric label="Capital" value={formatUsd(overview.capitalUsd)} hint={`balance ${formatUsd(overview.balanceUsd)}`} />
        <Metric label="Providers" value={`${overview.readyProviders} READY`} hint={`${overview.totalProviders} observed`} tone="good" />
        <Metric label="Current task" value={overview.currentTask?.title ?? "IDLE"} hint={overview.currentTask?.status ?? "no active task"} />
        <Metric label="Requests today" value={overview.requestsToday ?? "—"} />
        <Metric label="Monetary cost" value={formatUsd(overview.monetaryCostUsd)} />
        <Metric label="Resource cost" value={overview.effectiveResourceCost?.toFixed(2) ?? "—"} hint="effective normalized cost" />
        <Metric label="Memory" value={overview.memoryCount ?? "—"} />
        <Metric label="Success rate" value={formatPercent(overview.successRate)} tone="good" />
        <Metric label="Free resources" value={overview.freeResources ?? "—"} hint="zero-money options" />
      </section>

      <div className="grid-main">
        <Panel title="Why this model?" meta="latest decision">
          <ModelDecisionInspector decision={decision} />
        </Panel>
        <Panel title="Provider health" meta={`${providers.length} visible`}>
          {providers.length ? (
            <div className="compact-list">
              {providers.map((provider) => (
                <div className="compact-row" key={provider.id}>
                  <div><strong>{provider.name}</strong><span>{provider.models ?? "—"} models · {provider.auth}</span></div>
                  <div className="right-stack"><StatusBadge status={provider.status === "READY" || provider.status === "KEYLESS" ? "good" : provider.status === "RATE_LIMITED" || provider.status === "HUMAN_GATE" ? "warn" : "bad"}>{provider.status}</StatusBadge><span>{provider.latencyMs ? `${provider.latencyMs} ms` : "—"}</span></div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No provider telemetry" detail="Provider Runtime has not been connected to the dashboard adapter yet." />}
        </Panel>
      </div>

      <div className="grid-main lower-grid">
        <Panel title="Model usage" meta="share of recent requests">
          {overview.modelUsage.length ? (
            <div className="usage-bars">
              {overview.modelUsage.map((item) => (
                <div className="usage-row" key={item.label}>
                  <div className="usage-label"><span>{item.label}</span><strong>{item.value}%</strong></div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, item.value)}%` }} /></div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No model usage yet" detail="Usage telemetry will populate when model routing exposes a stable read contract." />}
        </Panel>
        <Panel title="Latest signals" meta="warnings & errors">
          {overview.recentErrors.length ? (
            <div className="event-list">
              {overview.recentErrors.map((event) => (
                <div className="event-row" key={event.id}>
                  <span className={`event-level level-${event.level}`}>{event.level}</span>
                  <div><strong>{event.event}</strong><span>{formatTime(event.createdAt)}</span></div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No recent errors" detail="Nothing classified as warning or error in the current data window." />}
        </Panel>
      </div>
    </DashboardShell>
  );
}
