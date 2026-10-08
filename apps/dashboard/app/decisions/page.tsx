import { CommandButton } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, StatusBadge, formatTime } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function DecisionsPage() {
  const source = getDashboardDataSource();
  const approvals = await source.getApprovals({ limit: 80 });

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="Decisoes" eyebrow="APPROVAL CENTER" description="Acoes externas aparecem aqui antes de qualquer envio. Cada aprovacao e especifica, auditavel e de uso unico." />
      <Panel title="Acoes que precisam de voce" meta={`${approvals.filter((approval) => approval.status === "PENDING").length} pendentes`}>
        {approvals.length ? (
          <div className="approval-list">
            {approvals.map((approval) => (
              <article className="approval-card" key={approval.technicalId ?? approval.id}>
                <div className="approval-title">
                  <div>
                    <div className="eyebrow">ACAO PRECISA DE VOCE</div>
                    <h3>{approval.title}</h3>
                    <span>Destino: {approval.destination}</span>
                  </div>
                  <StatusBadge status={approval.status === "PENDING" ? "warn" : approval.status === "CONSUMED" || approval.status === "APPROVED" ? "good" : "neutral"}>{approval.status}</StatusBadge>
                </div>
                <div className="fact-grid">
                  <span>Oportunidade<strong>{approval.opportunityTitle}</strong></span>
                  <span>Recompensa<strong>{approval.rewardLabel}</strong></span>
                  <span>Risco<strong>{approval.riskLabel}</strong></span>
                  <span>Criada<strong>{formatTime(approval.createdAt)}</strong></span>
                </div>
                <div className="preview-box">
                  <strong>O Beyonder pretende enviar</strong>
                  <p>{approval.payloadPreview}</p>
                </div>
                <div className="scope-box">
                  <strong>Ao aprovar, voce autoriza apenas isto:</strong>
                  <ul>{approval.authorizationScope.map((scope) => <li key={scope}>{scope}</li>)}</ul>
                </div>
                {approval.status === "PENDING" ? (
                  <div className="action-row">
                    <CommandButton payload={{ type: "rejectAction", approvalId: approval.technicalId, reason: "Rejected in Control Center" }} tone="quiet">Rejeitar</CommandButton>
                    <CommandButton payload={{ type: "approveAction", approvalId: approval.technicalId }} confirm={`Voce esta prestes a autorizar uma acao externa: ${approval.title} para ${approval.destination}.`}>Sim, autorizar</CommandButton>
                  </div>
                ) : null}
                <details className="why-box developer-only">
                  <summary>Detalhes tecnicos</summary>
                  <div className="technical-id">{approval.technicalId}</div>
                </details>
              </article>
            ))}
          </div>
        ) : <EmptyState title="Nenhuma decisao pendente" detail="Quando uma candidatura, mensagem ou submissao externa precisar de aprovacao, ela aparecera aqui." />}
      </Panel>
    </DashboardShell>
  );
}
