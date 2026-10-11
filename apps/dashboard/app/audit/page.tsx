import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, formatTime } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const source = getDashboardDataSource();
  const events = await source.getAuditEvents({ limit: 120 });
  const errors = events.filter((event) => event.level === "error").length;
  const warnings = events.filter((event) => event.level === "warn").length;

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="History" eyebrow="AUDIT / TRACE" description="Linha do tempo causal de missões, discovery, decisões, ferramentas e falhas. JSON bruto continua secundário." />
      <div className="page-facts audit-facts">
        <span><strong>{events.length}</strong> eventos</span>
        <span className={warnings ? "fact-attention" : ""}><strong>{warnings}</strong> warnings</span>
        <span className={errors ? "fact-attention" : ""}><strong>{errors}</strong> errors</span>
      </div>

      {events.length ? (
        <section className="audit-surface" aria-label="Audit timeline">
          <div className="audit-table-head"><span>Time</span><span>Event</span><span>Category</span><span>Level</span></div>
          <div className="audit-timeline">
            {events.map((event) => (
              <article className={`audit-item audit-level-${event.level}`} key={event.id}>
                <time className="audit-time">{formatTime(event.createdAt)}</time>
                <div className="audit-content"><strong>{event.humanEvent}</strong><details><summary>Raw details</summary><pre>{JSON.stringify({ event: event.event, details: event.details }, null, 2)}</pre></details></div>
                <span className="audit-category">{event.category}</span>
                <span className={`audit-level level-${event.level}`}>{event.level}</span>
              </article>
            ))}
          </div>
        </section>
      ) : <EmptyState title="Histórico vazio" detail="Eventos persistidos aparecerão aqui conforme o runtime processar objetivos, discovery, approvals, ferramentas e erros." />}
    </DashboardShell>
  );
}
