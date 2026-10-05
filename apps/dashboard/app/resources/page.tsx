import { SecretForm } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, StatusBadge, formatDuration, formatPercent, formatUsd } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const source = getDashboardDataSource();
  const [providers, decisions, economy] = await Promise.all([
    source.getProviders({ limit: 100 }),
    source.getModelDecisions({ limit: 20 }),
    source.getEconomySummary()
  ]);

  const ready = providers.filter((provider) => (provider.status === "READY" || provider.status === "KEYLESS") && provider.verified).length;
  const unavailable = providers.filter((provider) => ["UNHEALTHY", "RATE_LIMITED", "DISABLED"].includes(provider.status)).length;

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="Resources" eyebrow="COMPUTE / CAPACITY" description="Capacidade observável primeiro. Quota, saúde, latência e custo só aparecem quando existe verdade registrada." />

      <div className="page-facts resources-facts">
        <span><strong>{ready}</strong> ready</span>
        <span className={unavailable ? "fact-attention" : ""}><strong>{unavailable}</strong> degraded / unavailable</span>
        <span><strong>{providers.length}</strong> providers</span>
        <span><strong>{providers.filter((provider) => provider.status === "UNKNOWN").length}</strong> unknown</span>
      </div>

      {providers.length ? (
        <section className="resource-table" aria-label="Provider capacity">
          <div className="resource-table-head"><span>Provider</span><span>Health</span><span>Runway / quota</span><span>Latency</span><span>Placement</span></div>
          {providers.map((provider) => {
            const tone = (provider.status === "READY" || provider.status === "KEYLESS") && provider.verified ? "good" : ["UNHEALTHY", "RATE_LIMITED", "DISABLED"].includes(provider.status) ? "bad" : provider.status === "UNKNOWN" ? "neutral" : "warn";
            return <article className="resource-row" key={provider.id}>
              <div className="resource-provider">
                <div><strong>{provider.name}</strong><span>{provider.note ?? (provider.configured ? "Configured" : "Not configured")}</span></div>
                <StatusBadge status={tone}>{provider.status}</StatusBadge>
              </div>
              <div data-label="Health"><strong>{provider.health == null ? "UNKNOWN" : formatPercent(provider.health)}</strong><span>{provider.verified ? "verified" : "not verified"}</span></div>
              <div data-label="Runway / quota"><strong className={provider.runway.state === "UNKNOWN" ? "unknown-value" : ""}>{provider.runway.state}</strong><span>{provider.runway.label}</span></div>
              <div data-label="Latency"><strong className={provider.latencyMs == null ? "unknown-value" : ""}>{provider.latencyMs == null ? "UNKNOWN" : formatDuration(provider.latencyMs)}</strong><span>{provider.lastCheckAt ? "observed" : "not observed"}</span></div>
              <div data-label="Placement"><strong className="unknown-value">UNKNOWN</strong><span>cloud/local not exposed</span></div>
              {!provider.configured && provider.setupEnvVar ? (
                <div className="resource-setup">
                  <details className="resource-setup-disclosure">
                    <summary><span>Configure credentials</span><code>{provider.setupEnvVar}</code></summary>
                    <div className="resource-setup-form"><SecretForm providerId={provider.id} envVar={provider.setupEnvVar} /></div>
                  </details>
                </div>
              ) : null}
            </article>;
          })}
        </section>
      ) : <EmptyState title="Nenhum provider observado" detail="Configure providers quando quiser ampliar a capacidade. O frontend nunca recebe secrets existentes." />}

      <section className="resource-secondary-grid">
        <div className="resource-accounting">
          <div className="section-heading compact-heading"><div><span className="eyebrow">ACCOUNTING</span><h2>Resource truth</h2></div></div>
          <dl>
            <div><dt>Dinheiro real gasto</dt><dd>{formatUsd(economy.realMoneySpentUsd)}</dd></div>
            <div><dt>Compute consumido</dt><dd>{economy.computeConsumed}</dd></div>
            <div><dt>Shadow/resource cost</dt><dd>{formatUsd(economy.shadowCostUsd)}</dd></div>
            <div><dt>Receita real</dt><dd>{formatUsd(economy.realRevenueUsd)}</dd></div>
            <div><dt>Receita simulada</dt><dd>{formatUsd(economy.simulatedRevenueUsd)}</dd></div>
          </dl>
        </div>

        <div className="resource-routing">
          <div className="section-heading compact-heading"><div><span className="eyebrow">ROUTING</span><h2>Recent model decisions</h2></div></div>
          {decisions.length ? <div className="routing-list">{decisions.slice(0, 8).map((decision) => <details className="routing-row" key={decision.id}><summary><strong>{decision.selectedLabel}</strong><span>{decision.utility == null ? "utility UNKNOWN" : `utility ${formatPercent(decision.utility)}`}</span></summary><ul>{decision.humanWhy.map((why) => <li key={why}>{why}</li>)}</ul></details>)}</div> : <EmptyState title="Nenhuma decisão de modelo" detail="As seleções aparecerão quando o Adaptive Router registrar decisões." />}
        </div>
      </section>
    </DashboardShell>
  );
}
