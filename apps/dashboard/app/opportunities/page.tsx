import { CommandButton } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, StatusBadge } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const source = getDashboardDataSource();
  const opportunities = await source.getOpportunities({ limit: 80 });

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="Oportunidades" eyebrow="OPPORTUNITY ENGINE" description="Busca read-only, avaliacao economica e preparacao de candidatura sem executar acao externa sem aprovacao." />
      <div className="action-row spaced">
        <CommandButton payload={{ type: "discoverOpportunities" }}>Procurar oportunidades</CommandButton>
      </div>
      <Panel title="Oportunidades avaliadas" meta={`${opportunities.length} encontradas`}>
        {opportunities.length ? (
          <div className="opportunity-grid">
            {opportunities.map((opportunity) => (
              <article className="opportunity-card" key={opportunity.technicalId ?? opportunity.id}>
                <div className="opportunity-head">
                  <div>
                    <span className="source-label">{opportunity.source}</span>
                    <h3>{opportunity.title}</h3>
                  </div>
                  <StatusBadge status={opportunity.riskLabel === "Baixo" ? "good" : opportunity.riskLabel === "Medio" ? "warn" : "bad"}>{opportunity.riskLabel}</StatusBadge>
                </div>
                <div className="fact-grid">
                  <span>Recompensa<strong>{opportunity.rewardLabel}</strong></span>
                  <span>Chance estimada<strong>{opportunity.estimatedSuccessLabel}</strong></span>
                  <span>Custo estimado<strong>{opportunity.estimatedCostLabel}</strong></span>
                  <span>Prazo<strong>{opportunity.deadlineLabel}</strong></span>
                </div>
                <p>{opportunity.humanSummary}</p>
                <details className="why-box">
                  <summary>Por que?</summary>
                  <ul>{opportunity.why.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                </details>
                <div className="action-row">
                  {opportunity.canPrepareApplication ? <CommandButton payload={{ type: "prepareApplication", opportunityId: opportunity.technicalId }}>Preparar candidatura</CommandButton> : null}
                </div>
              </article>
            ))}
          </div>
        ) : <EmptyState title="Nenhuma oportunidade encontrada ainda" detail="Clique em Procurar oportunidades. Falhas de uma fonte nao significam ausencia total de oportunidades." />}
      </Panel>
    </DashboardShell>
  );
}
