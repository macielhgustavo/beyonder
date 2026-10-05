import { EvidenceForm } from "../../components/evidence-form";
import { CommandButton } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, formatUsd } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function WorkPage() {
  const source = getDashboardDataSource();
  const runs = await source.getWorkRuns();
  return <DashboardShell provenance={source.provenance}>
    <PageHeader title="Work" eyebrow="ECONOMIC LIFECYCLE" description="Somente oportunidades que viraram trabalho econômico: candidatura, execução, entrega e settlement." />
    <div className="action-row spaced"><CommandButton payload={{ type: "pauseRuntime" }} tone="danger">Pausar Beyonder</CommandButton><CommandButton payload={{ type: "resumeRuntime" }}>Retomar</CommandButton></div>
    <Panel title="Trabalhos econômicos" meta={`${runs.length} ativos ou históricos`}>
      {runs.length ? <div className="work-list">{runs.map((run) => <article className="task-card work-card" key={run.id}>
        <div className="task-summary"><div><span className="eyebrow">{run.source}</span><h3>{run.title}</h3>{run.fixture ? <span className="demo-badge">TEST DATA — nenhuma ação real</span> : null}<p>{!run.fixture && run.application?.status === "SENT" && !run.application.externalEvidence && run.application.mode !== "AUTOMATED_REAL" ? "Candidatura sem evidência de envio" : workState(run.state)}</p></div><strong>{run.estimatedRewardUsd === undefined ? "Recompensa não informada" : `${formatUsd(run.estimatedRewardUsd)} estimados`}</strong></div>
        <div className="fact-grid">
          <span>Candidatura<strong>{run.application?.status === "SENT" ? (run.fixture || run.application.externalEvidence || run.application.mode === "AUTOMATED_REAL" ? "✓ enviada" : "Envio sem evidência registrada") : run.application?.status === "MANUAL_ACTION_REQUIRED" ? "Autorizada; envio manual necessário" : "Aguardando"}</strong></span>
          <span>Execução<strong>{run.execution?.status === "COMPLETED" ? "✓ concluída" : run.execution?.status === "RUNNING" ? "Trabalhando" : "Aguardando"}</strong></span>
          <span>Entrega<strong>{run.deliverable ? `${run.deliverable.summary} — ${run.deliverable.verificationStatus === "PASS" ? "✓ verificada" : "Aguardando verificação"}` : "Ainda não preparada"}</strong></span>
          <span>Submissão<strong>{["AWAITING_SETTLEMENT", "COMPLETED"].includes(run.state) ? "✓ enviada" : run.state === "AWAITING_SUBMISSION_APPROVAL" ? "Aguardando sua aprovação" : "Aguardando"}</strong></span>
          <span>Pagamento<strong>{run.settlement ? "Evidência registrada" : "Aguardando pagamento"}</strong></span>
          <span>Receita realizada<strong>{formatUsd(run.fixture ? 0 : run.realizedRewardUsd)}</strong></span>
        </div>
        {run.sourceUrl ? <a className="secondary-link" href={run.sourceUrl} target="_blank" rel="noopener noreferrer">Abrir oportunidade</a> : null}
        {run.state === "MANUAL_APPLICATION_REQUIRED" || run.state === "MANUAL_SUBMISSION_REQUIRED" ? <><p>{run.state === "MANUAL_APPLICATION_REQUIRED" ? "Candidatura autorizada. Faça o envio no marketplace e registre a evidência aqui." : "Entrega autorizada. Faça a submissão no marketplace e registre a evidência aqui."}</p><EvidenceForm workRunId={run.id} kind={run.state === "MANUAL_APPLICATION_REQUIRED" ? "confirmApplication" : "confirmSubmission"} /></> : null}
        {!run.fixture && run.state === "AWAITING_SETTLEMENT" ? <EvidenceForm workRunId={run.id} kind="recordSettlement" /> : null}
      </article>)}</div> : <EmptyState title="Nenhum trabalho econômico" detail="Missões comuns ficam em Missões. Um trabalho aparece aqui somente depois que uma oportunidade entra no ciclo econômico." />}
    </Panel>
  </DashboardShell>;
}

function workState(state: string) { const labels: Record<string, string> = { APPLICATION_SENT: "Candidatura enviada", MANUAL_APPLICATION_REQUIRED: "Envio manual necessário", MANUAL_SUBMISSION_REQUIRED: "Entrega manual necessária", AWAITING_APPLICATION_APPROVAL: "Esperando sua aprovação", AWAITING_SUBMISSION_APPROVAL: "Esperando aprovação da entrega", AWAITING_SETTLEMENT: "Aguardando pagamento", COMPLETED: "Trabalho concluído", EXECUTING: "Trabalhando", WORK_READY: "Entrega preparada" }; return labels[state] ?? "Preparando trabalho"; }
