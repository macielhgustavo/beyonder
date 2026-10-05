import { CommandButton } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, StatusBadge, formatTime } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function DecisionsPage() {
  const source = getDashboardDataSource();
  const approvals = await source.getApprovals({ limit: 80 });
  const pending = approvals.filter((approval) => approval.status === "PENDING");
  const decided = approvals.filter((approval) => approval.status !== "PENDING");

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="Decisions" eyebrow="APPROVAL CENTER" description="Autorizações externas explícitas, específicas e auditáveis. Nada aqui amplia o escopo além do que está descrito." />
      <div className="page-facts">
        <span className={pending.length ? "fact-attention" : ""}><strong>{pending.length}</strong> aguardando você</span>
        <span><strong>{decided.length}</strong> decididas</span>
        <span><strong>{approvals.length}</strong> total</span>
      </div>

      {pending.length ? (
        <section className="decision-section">
          <div className="section-heading section-heading-strong"><div><span className="eyebrow">REQUIRES OPERATOR</span><h2>Aguardando autorização</h2></div></div>
          <div className="approval-list approval-list-premium">{pending.map((approval) => <ApprovalCard approval={approval} key={approval.technicalId ?? approval.id} />)}</div>
        </section>
      ) : <EmptyState title="Nenhuma decisão pendente" detail="Ações externas continuam bloqueadas até existir uma autorização específica para o payload e destino mostrados aqui." />}

      {decided.length ? (
        <section className="decision-section decision-section-history">
          <div className="section-heading"><div><span className="eyebrow">RECENT DECISIONS</span><h2>Histórico de autorizações</h2></div></div>
          <div className="approval-history">{decided.map((approval) => <ApprovalCard approval={approval} compact key={approval.technicalId ?? approval.id} />)}</div>
        </section>
      ) : null}
    </DashboardShell>
  );
}

function ApprovalCard({ approval, compact = false }: { approval: Awaited<ReturnType<ReturnType<typeof getDashboardDataSource>["getApprovals"]>>[number]; compact?: boolean }) {
  const tone = approval.status === "PENDING" ? "warn" : approval.status === "CONSUMED" || approval.status === "APPROVED" ? "good" : "neutral";
  return <article className={`approval-card${compact ? " approval-card-compact" : ""}`}>
    <div className="approval-title">
      <div>
        <div className="eyebrow">{approval.status === "PENDING" ? "EXTERNAL ACTION" : "DECISION"}</div>
        <h3>{approval.title}</h3>
        <span>Destino · {approval.destination}</span>
      </div>
      <StatusBadge status={tone}>{approval.status}</StatusBadge>
    </div>

    <dl className="approval-facts">
      <div><dt>Opportunity</dt><dd>{approval.opportunityTitle}</dd></div>
      <div><dt>Reward</dt><dd>{approval.rewardLabel}</dd></div>
      <div><dt>Risk</dt><dd>{approval.riskLabel}</dd></div>
      <div><dt>Created</dt><dd>{formatTime(approval.createdAt)}</dd></div>
    </dl>

    {!compact ? <>
      <div className="approval-payload"><span className="micro-label">Exact payload preview</span><p>{approval.payloadPreview}</p></div>
      <div className="approval-scope"><span className="micro-label">Authorization scope</span><ul>{approval.authorizationScope.map((scope) => <li key={scope}>{scope}</li>)}</ul></div>
      {approval.status === "PENDING" ? <div className="approval-actions"><span>Autorizar não envia nada além deste escopo.</span><div className="action-row"><CommandButton payload={{ type: "rejectAction", approvalId: approval.technicalId, reason: "Rejected in Control Center" }} tone="quiet">Rejeitar</CommandButton><CommandButton payload={{ type: "approveAction", approvalId: approval.technicalId }} confirm={`Você está prestes a autorizar uma ação externa: ${approval.title} para ${approval.destination}.`}>Autorizar ação</CommandButton></div></div> : null}
    </> : null}

    <details className="technical-inline developer-only"><summary>Technical ID</summary><code>{approval.technicalId}</code></details>
  </article>;
}
