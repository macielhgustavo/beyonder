import { CommandButton } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, StatusBadge } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const source = getDashboardDataSource();
  const [health, opportunities] = await Promise.all([source.getSourceHealth(), source.getOpportunities({ limit: 80 })]);

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="Oportunidades" eyebrow="DESCOBERTA" description="Pesquisa de oportunidades, avaliação econômica e preparação de candidaturas com aprovação humana." />
      <div className="action-row spaced">
        <CommandButton payload={{ type: "discoverOpportunities" }}>Procurar oportunidades</CommandButton>
      </div>
      <Panel title="Fontes"><div className="action-row">{health.map((item) => <span key={item.sourceId}>{item.sourceId}: {item.status === "HEALTHY" ? "✓ disponível" : "⚠ indisponível"}</span>)}</div></Panel>
      <Panel title="Oportunidades avaliadas" meta={`${opportunities.length} encontradas`}>
        {opportunities.length ? (
          <div className="opportunity-grid">
            {opportunities.map((opportunity) => (
              <article className="opportunity-card" key={opportunity.technicalId ?? opportunity.id}>
                <div className="opportunity-head">
                  <div>
                    <span className="source-label">{opportunity.source}</span>
                    <h3>{opportunity.title}</h3>{opportunity.fixture ? <span className="demo-badge">TEST DATA</span> : null}
                  </div>
                  <StatusBadge status={opportunity.riskLabel === "Baixo" ? "good" : opportunity.riskLabel === "Medio" ? "warn" : "bad"}>{opportunity.riskLabel}</StatusBadge>
                </div>
                <div className="fact-grid">
                  <span>Recompensa<strong>{opportunity.rewardLabel}</strong></span>
                  <span>Chance estimada<strong>{opportunity.estimatedSuccessLabel}</strong></span>
                  <span>Custo estimado<strong>{opportunity.estimatedCostLabel}</strong></span>
                  <span>Prazo<strong>{opportunity.deadlineLabel}</strong></span>
                </div>
                <p>{opportunity.humanSummary}</p>{opportunity.externalActionMode === "MANUAL_REQUIRED" ? <p>Este marketplace exige envio manual após sua autorização.</p> : null}
                <details className="why-box">
                  <summary>Por que?</summary>
                  <ul>{opportunity.why.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                </details>
                <div className="action-row">
                  {opportunity.sourceUrl ? <a className="secondary-link" href={opportunity.sourceUrl} target="_blank" rel="noopener noreferrer">Abrir oportunidade</a> : null}
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
