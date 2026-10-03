import { DashboardShell } from "../../components/shell";
import { ModelDecisionInspector } from "../../components/model-decision-inspector";
import { EmptyState, PageHeader, Panel, ProvenanceNotice, formatPercent } from "../../components/ui";
import { getDashboardDataSource, type Capability } from "../../data";

export const dynamic = "force-dynamic";
const capabilities: Capability[] = ["coding", "reasoning", "planning", "tool-use", "structured", "extraction", "compression", "memory"];

export default async function IntelligencePage() {
  const source = getDashboardDataSource();
  const [models, overview] = await Promise.all([source.getModels({ limit: 50 }), source.getOverview()]);

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader eyebrow="INTELLIGENCE / INSPECTOR" title="Intelligence" description="Model inventory and capability surfaces prepared for the Beyonder Intelligence Benchmark, without implementing BIB here." />
      <ProvenanceNotice provenance={source.provenance} />
      <div className="grid-main">
        <Panel title="Why this model?" meta="router decision surface"><ModelDecisionInspector decision={overview.recentDecisions[0]} /></Panel>
        <Panel title="Capability map" meta="BIB-ready schema">
          <div className="capability-list">{capabilities.map((capability) => <div className="capability-row" key={capability}><span>{capability}</span><div className="capability-placeholder">awaiting benchmark</div></div>)}</div>
        </Panel>
      </div>

      <Panel title="Model registry" meta={`${models.length} visible`} className="spaced-panel">
        {models.length ? <div className="table-wrap"><table><thead><tr><th>Model</th><th>Provider</th><th>Usage</th><th>Latency</th><th>Success</th><th>Effective cost</th><th>Capabilities</th></tr></thead><tbody>{models.map((model) => <tr key={model.id}><td><strong>{model.name}</strong><span className="cell-note">{model.benchmarkAvailable ? "benchmark connected" : "benchmark pending"}</span></td><td>{model.provider}</td><td>{model.usage ?? "—"}</td><td>{model.latencyMs == null ? "—" : `${model.latencyMs} ms`}</td><td>{formatPercent(model.successRate)}</td><td>{model.effectiveCost?.toFixed(2) ?? "—"}</td><td><div className="capability-tags">{Object.entries(model.capabilities).map(([name, score]) => <span key={name}>{name} {typeof score === "number" ? score.toFixed(2) : "—"}</span>)}</div></td></tr>)}</tbody></table></div> : <EmptyState title="No model telemetry" detail="BIB and Adaptive Router can feed this surface later through the dashboard contract without changing the UI layer." />}
      </Panel>
    </DashboardShell>
  );
}
