import { DashboardShell } from "../../components/shell";
import { EmptyState, Metric, PageHeader, Panel, ProvenanceNotice, formatUsd } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function EconomyPage() {
  const source = getDashboardDataSource();
  const economy = await source.getEconomy();

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader eyebrow="ECONOMY / READ-ONLY" title="Economy" description="Capital, spend, runway and quota visibility without wallet or payment controls." />
      <ProvenanceNotice provenance={source.provenance} />
      <section className="metric-strip metric-strip-6">
        <Metric label="Balance" value={formatUsd(economy.balanceUsd)} />
        <Metric label="Revenue" value={formatUsd(economy.revenueUsd)} tone="good" />
        <Metric label="Expenses" value={formatUsd(economy.expensesUsd)} tone="warn" />
        <Metric label="Runway" value={economy.runwayDays == null ? "—" : `${economy.runwayDays.toFixed(1)}d`} />
        <Metric label="Monetary spend" value={formatUsd(economy.monetarySpendUsd)} />
        <Metric label="Shadow spend" value={economy.shadowSpend == null ? "—" : economy.shadowSpend.toFixed(2)} hint="normalized resource spend" />
      </section>

      <div className="grid-main">
        <Panel title="Economic history" meta={economy.economicState.toUpperCase()}>
          {economy.history.length ? (
            <div className="history-chart" aria-label="Balance history">
              {economy.history.map((point, index) => (
                <div className="history-column" key={`${point.at}-${index}`}>
                  <div className="history-value">{formatUsd(point.balanceUsd)}</div>
                  <div className="history-stem" style={{ height: `${28 + Math.min(92, Math.abs(point.balanceUsd) * 8)}px` }} />
                  <div className="history-date">{new Intl.DateTimeFormat("en", { month: "short", day: "2-digit" }).format(new Date(point.at))}</div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No ledger history" detail="The local ledger is empty or unavailable. No financial values are invented." />}
        </Panel>
        <Panel title="Quota pressure" meta="provider budgets">
          {economy.quotas.length ? (
            <div className="usage-bars">
              {economy.quotas.map((quota) => {
                const pct = quota.used != null && quota.limit ? Math.min(100, (quota.used / quota.limit) * 100) : 0;
                return <div className="usage-row" key={quota.label}><div className="usage-label"><span>{quota.label}</span><strong>{quota.used ?? "—"}/{quota.limit ?? "—"} {quota.unit}</strong></div><div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div></div>;
              })}
            </div>
          ) : <EmptyState title="No quota telemetry" detail="Quota data will connect through the Provider Runtime adapter, not by scraping secrets or environment variables." />}
        </Panel>
      </div>

      <Panel title="Future economic surfaces" meta="prepared, not active" className="spaced-panel">
        <div className="future-grid">
          <Future label="ROI" detail="Reserved for attributable return once revenue instrumentation exists." />
          <Future label="Revenue streams" detail="Reserved for future autonomous income sources." />
          <Future label="Payments" detail="No wallet, x402 or payment execution in this branch." />
          <Future label="Settlement" detail="Read-only placeholder; no transfer capability exists here." />
        </div>
      </Panel>
    </DashboardShell>
  );
}

function Future({ label, detail }: { label: string; detail: string }) {
  return <div className="future-item"><div className="micro-label">{label}</div><p>{detail}</p></div>;
}
