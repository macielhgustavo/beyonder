import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, ProvenanceNotice, StatusBadge, formatPercent, formatTime } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  const source = getDashboardDataSource();
  const providers = await source.getProviders({ limit: 50 });

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader eyebrow="COMPUTE / PROVIDERS" title="Providers" description="Health, quota, latency and authentication posture. Secret material is never exposed." />
      <ProvenanceNotice provenance={source.provenance} />
      <Panel title="Provider inventory" meta={`${providers.length} records`}>
        {providers.length ? (
          <div className="table-wrap"><table><thead><tr><th>Provider</th><th>Status</th><th>Models</th><th>Quota</th><th>Latency</th><th>Health</th><th>Auth</th><th>Last check</th></tr></thead><tbody>
            {providers.map((provider) => <tr key={provider.id}><td><strong>{provider.name}</strong>{provider.note ? <span className="cell-note">{provider.note}</span> : null}</td><td><StatusBadge status={provider.status === "READY" || provider.status === "KEYLESS" ? "good" : provider.status === "RATE_LIMITED" || provider.status === "HUMAN_GATE" ? "warn" : "bad"}>{provider.status}</StatusBadge></td><td>{provider.models ?? "—"}</td><td>{provider.quota ?? "—"}</td><td>{provider.latencyMs == null ? "—" : `${provider.latencyMs} ms`}</td><td>{formatPercent(provider.health)}</td><td>{provider.auth}</td><td>{formatTime(provider.lastCheckAt)}</td></tr>)}
          </tbody></table></div>
        ) : <EmptyState title="No providers connected" detail="The stable Provider Runtime read adapter is intentionally not coupled yet. Groq, Kilo, OVH and AI Horde will appear when provider telemetry is exposed." />}
      </Panel>
    </DashboardShell>
  );
}
