import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, ProvenanceNotice, formatTime } from "../../components/ui";
import { getDashboardDataSource, type AuditEventView } from "../../data";

export const dynamic = "force-dynamic";
const levels: Array<AuditEventView["level"] | "all"> = ["all", "debug", "info", "warn", "error", "unknown"];

export default async function AuditPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const search = typeof params?.q === "string" ? params.q : "";
  const requested = typeof params?.level === "string" ? params.level : "all";
  const level = levels.includes(requested as AuditEventView["level"] | "all") ? requested as AuditEventView["level"] | "all" : "all";
  const source = getDashboardDataSource();
  const events = await source.getAuditEvents({ search, level, limit: 100 });

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader eyebrow="RUNTIME / AUDIT" title="Audit" description="Chronological runtime events with redacted details and bounded pagination windows." />
      <ProvenanceNotice provenance={source.provenance} />
      <Panel title="Event stream" meta={`${events.length} loaded`}>
        <form className="filter-bar" method="get"><input name="q" defaultValue={search} placeholder="Search event or details" aria-label="Search audit events" /><select name="level" defaultValue={level} aria-label="Filter by audit level">{levels.map((item) => <option key={item} value={item}>{item}</option>)}</select><button type="submit">Filter</button></form>
        {events.length ? <div className="audit-timeline">{events.map((event) => <div className="audit-item" key={event.id}><div className={`audit-dot level-${event.level}`} /><div className="audit-time">{formatTime(event.createdAt)}</div><div className="audit-content"><strong>{event.event}</strong><pre>{JSON.stringify(event.details, null, 2)}</pre></div></div>)}</div> : <EmptyState title="No audit events" detail="The audit table is empty, unavailable, or no records match the current filters." />}
      </Panel>
    </DashboardShell>
  );
}
