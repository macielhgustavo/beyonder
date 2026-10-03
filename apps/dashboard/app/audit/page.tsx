import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, formatTime } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const source = getDashboardDataSource();
  const events = await source.getAuditEvents({ limit: 120 });

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="Historico" eyebrow="AUDIT / TRACE" description="Linha do tempo causal de trabalhos, oportunidades, decisoes e erros. JSON bruto fica em detalhes tecnicos." />
      <Panel title="Timeline" meta={`${events.length} eventos`}>
        {events.length ? (
          <div className="audit-timeline">
            {events.map((event) => (
              <div className="audit-item" key={event.id}>
                <span className={`audit-dot level-${event.level}`} />
                <span className="audit-time">{formatTime(event.createdAt)}</span>
                <div className="audit-content">
                  <strong>{event.humanEvent}</strong>
                  <span className="cell-note">{event.category}</span>
                  <details>
                    <summary>Detalhes tecnicos</summary>
                    <pre>{JSON.stringify({ event: event.event, details: event.details }, null, 2)}</pre>
                  </details>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Historico vazio" detail="Eventos de objetivo, discovery, approvals, ferramentas e erros aparecerao aqui." />}
      </Panel>
    </DashboardShell>
  );
}
