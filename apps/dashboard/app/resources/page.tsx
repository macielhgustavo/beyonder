import { SecretForm } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, StatusBadge, formatDuration } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const source = getDashboardDataSource();
  const [providers, decisions, economy] = await Promise.all([
    source.getProviders({ limit: 100 }),
    source.getModelDecisions({ limit: 20 }),
    source.getEconomySummary()
  ]);

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="Recursos" eyebrow="MODELOS E COMPUTE" description="Quanto de inteligencia esta disponivel, quais modelos foram escolhidos e como custo real e resource cost permanecem separados." />
      <section className="metric-strip">
        <div className="metric"><div className="metric-label">Dinheiro real gasto</div><div className="metric-value">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(economy.realMoneySpentUsd)}</div></div>
        <div className="metric"><div className="metric-label">Compute consumido</div><div className="metric-value">{economy.computeConsumed}</div></div>
        <div className="metric"><div className="metric-label">Shadow/resource cost</div><div className="metric-value">{economy.shadowCostUsd.toFixed(4)}</div></div>
        <div className="metric"><div className="metric-label">Receita real</div><div className="metric-value">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(economy.realRevenueUsd)}</div></div>
        <div className="metric"><div className="metric-label">Receita simulada</div><div className="metric-value">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(economy.simulatedRevenueUsd)}</div></div>
      </section>
      <div className="grid-main">
        <Panel title="Providers" meta={`${providers.length} conhecidos`}>
          {providers.length ? (
            <div className="compact-list">
              {providers.map((provider) => (
                <div className="compact-row" key={provider.id}>
                  <div><strong>{provider.name}</strong><span>{provider.note ?? provider.runway.label}</span></div>
                  <div className="right-stack">
                    <StatusBadge status={provider.status === "READY" || provider.status === "KEYLESS" ? "good" : provider.status === "UNKNOWN" ? "neutral" : "warn"}>{provider.status}</StatusBadge>
                    <span>{provider.runway.state}: {provider.runway.label}</span>
                    <span>{provider.latencyMs ? formatDuration(provider.latencyMs) : "latencia desconhecida"}</span>
                    {!provider.configured && provider.setupEnvVar ? <SecretForm providerId={provider.id} envVar={provider.setupEnvVar} /> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Nenhum provider observado" detail="Configure providers quando quiser ampliar a capacidade. O frontend nunca recebe secrets existentes." />}
        </Panel>
        <Panel title="Por que este modelo?" meta="historico recente">
          {decisions.length ? (
            <div className="compact-list">
              {decisions.map((decision) => (
                <details className="decision-mini" key={decision.id}>
                  <summary>{decision.selectedLabel}</summary>
                  <ul>{decision.humanWhy.map((why) => <li key={why}>{why}</li>)}</ul>
                </details>
              ))}
            </div>
          ) : <EmptyState title="Nenhuma decisao de modelo ainda" detail="As decisoes aparecerao quando o Adaptive Router registrar selecoes." />}
        </Panel>
      </div>
    </DashboardShell>
  );
}
