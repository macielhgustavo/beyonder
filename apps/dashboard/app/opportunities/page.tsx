import { CommandButton } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, StatusBadge } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const source = getDashboardDataSource();
  const [health, opportunities] = await Promise.all([source.getSourceHealth(), source.getOpportunities({ limit: 80 })]);

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader
        title="Opportunities"
        eyebrow="DISCOVERY / EVALUATION"
        description="Coisas que Beyonder encontrou e ainda está avaliando. Nenhum item aqui é trabalho iniciado."
        right={<CommandButton payload={{ type: "discoverOpportunities" }}>Procurar agora</CommandButton>}
      />

      <section className="source-health-strip" aria-label="Source health">
        <span className="micro-label">SOURCES</span>
        {health.length ? health.map((item) => (
          <span className={`source-health source-health-${item.status === "HEALTHY" ? "good" : "bad"}`} key={item.sourceId}>
            <span className="source-health-dot" />{item.sourceId}<small>{item.status}</small>
          </span>
        )) : <span className="unknown-value">Source health · UNKNOWN</span>}
      </section>

      {opportunities.length ? (
        <div className="opportunity-list">
          {opportunities.map((opportunity) => (
            <article className="opportunity-row" key={opportunity.technicalId ?? opportunity.id}>
              <div className="opportunity-main">
                <div className="opportunity-kicker">
                  <span className="source-label">{opportunity.source}</span>
                  <StatusBadge status={opportunity.riskLabel === "Baixo" ? "good" : opportunity.riskLabel === "Medio" ? "warn" : "bad"}>{opportunity.riskLabel}</StatusBadge>
                  {opportunity.fixture ? <span className="demo-badge inline-demo">TEST DATA</span> : null}
                </div>
                <h2>{opportunity.title}</h2>
                <p>{opportunity.humanSummary}</p>
                <div className="opportunity-decision"><span className="micro-label">Assessment</span><strong>{opportunity.decisionLabel}</strong></div>
              </div>

              <div className="opportunity-reward">
                <span>Reward</span>
                <strong>{opportunity.rewardLabel}</strong>
                <small>{opportunity.deadlineLabel}</small>
              </div>

              <dl className="opportunity-facts">
                <div><dt>Fit / feasibility</dt><dd>{opportunity.feasibility || "UNKNOWN"}</dd></div>
                <div><dt>Confidence</dt><dd>{opportunity.confidenceLabel || "UNKNOWN"}</dd></div>
                <div><dt>Success estimate</dt><dd>{opportunity.estimatedSuccessLabel || "UNKNOWN"}</dd></div>
                <div><dt>Estimated cost</dt><dd>{opportunity.estimatedCostLabel || "UNKNOWN"}</dd></div>
                <div><dt>Expected value</dt><dd className="unknown-value">UNKNOWN</dd></div>
                <div><dt>External action</dt><dd>{opportunity.externalActionMode === "MANUAL_REQUIRED" ? "Manual required" : opportunity.externalActionMode === "AUTOMATED_REAL" ? "Automated real" : opportunity.externalActionMode === "FIXTURE" ? "Fixture" : "UNKNOWN"}</dd></div>
              </dl>

              <div className="opportunity-footer">
                <details className="why-box">
                  <summary>Why this assessment</summary>
                  <ul>{opportunity.why.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                </details>
                <div className="action-row">
                  {opportunity.sourceUrl ? <a className="secondary-link" href={opportunity.sourceUrl} target="_blank" rel="noopener noreferrer">Abrir fonte</a> : null}
                  {opportunity.canPrepareApplication ? <CommandButton payload={{ type: "prepareApplication", opportunityId: opportunity.technicalId }}>Preparar candidatura</CommandButton> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : <EmptyState title="Nenhuma oportunidade encontrada" detail="Execute discovery. Falha de uma fonte não é tratada como ausência total de oportunidades." />}
    </DashboardShell>
  );
}
