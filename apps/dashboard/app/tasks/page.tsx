import { EvidenceForm } from "../../components/evidence-form";
import { CommandButton } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, StatusBadge, formatDuration, formatTime, formatUsd } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const source = getDashboardDataSource();
  const [runs, tasks] = await Promise.all([source.getWorkRuns(), source.getTasks({ limit: 50 })]);

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="Trabalhos" eyebrow="EXECUCAO" description="Acompanhe objetivos, candidaturas, entregas e pagamento com estados registrados." />
      <div className="action-row spaced">
        <CommandButton payload={{ type: "pauseRuntime" }} tone="danger">Pausar</CommandButton>
        <CommandButton payload={{ type: "resumeRuntime" }}>Retomar</CommandButton>
      </div>
      <Panel title="Trabalhos recentes" meta={`${tasks.length} visiveis`}>
        {tasks.length ? (
          <div className="task-list">
            {tasks.map((task) => (
              <article className="task-card" key={task.technicalId ?? task.id}>
                <div className="task-summary">
                  <div>
                    <StatusBadge status={task.status === "succeeded" ? "good" : task.status === "failed" ? "bad" : task.status === "running" ? "info" : "neutral"}>{task.humanStatus}</StatusBadge>
                    <h3>{task.title}</h3>{task.fixture ? <span className="demo-badge">TEST DATA</span> : null}
                    {task.failureSummary ? <p role="alert">{task.failureSummary}</p> : null}
                    <p>Agora: {task.current ?? task.humanStatus}</p><p>Próximo: {task.next ?? "Nenhum passo pendente"}</p>
                    <div className="task-meta">
                      <span>Modelo: {task.model && task.provider ? `${task.model} / ${task.provider}` : "nao registrado"}</span>
                      <span>Ferramenta: {task.tool || "Não registrada"}</span><span>Custo de recursos: {formatUsd(task.shadowCostUsd)}</span>
                      <span>Custo real: {formatUsd(task.costUsd)}</span>
                      <span>Tempo: {formatDuration(task.durationMs)}</span>
                      <span>Inicio: {formatTime(task.startedAt)}</span>
                    </div>
                  </div>
                  {task.result ? <strong>{task.result}</strong> : null}
                </div>
                <div className="task-flow">
                  {task.steps.map((step, index) => (
                    <div className={`task-step task-step-${step.state}`} key={`${task.id}-${index}`}>
                      <span className="step-index">{step.state === "complete" ? "✓" : step.state === "active" ? "●" : "○"}</span>
                      <div><strong>{step.label}</strong>{step.detail ? <span>{step.detail}</span> : null}</div>
                    </div>
                  ))}
                </div>
                <details className="why-box">
                  <summary>Por que?</summary>
                  <ul>{task.why.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  <div className="technical-id">Detalhes tecnicos: {task.technicalId}</div>
                </details>
                {task.attempts?.length ? <details className="why-box"><summary>Detalhes técnicos das tentativas</summary><ol>{task.attempts.map((attempt, index) => <li key={index}>{attempt.phase} · {attempt.provider} / {attempt.model} · {attempt.status}{attempt.failureClass ? ` · ${attempt.failureClass}` : ""}{attempt.httpStatus ? ` · HTTP ${attempt.httpStatus}` : ""}{attempt.error ? <p>{attempt.error}</p> : null}</li>)}</ol></details> : null}
              </article>
            ))}
          </div>
        ) : <EmptyState title="Nenhum trabalho ainda" detail="Digite um objetivo na Home para iniciar a primeira execucao sem terminal." />}
      </Panel>
      <Panel title="Trabalhos econômicos">
        {runs.length ? runs.map((run) => <article className="task-card" key={run.id}>
          <h3>{run.source} — {run.title} — {formatUsd(run.estimatedRewardUsd ?? 0)}</h3>
          {run.fixture ? <span className="demo-badge">TEST DATA — nenhuma ação real</span> : null}
          <p>{!run.fixture && run.application?.status === "SENT" && !run.application.externalEvidence && run.application.mode !== "AUTOMATED_REAL" ? "Candidatura sem evidência de envio" : workState(run.state)}</p>
          <div className="fact-grid">
            <span>Candidatura<strong>{run.application?.status === "SENT" ? (run.fixture || run.application.externalEvidence || run.application.mode === "AUTOMATED_REAL" ? "✓ enviada" : "Envio sem evidência registrada") : run.application?.status === "MANUAL_ACTION_REQUIRED" ? "Autorizada; envio manual necessário" : "Aguardando"}</strong></span>
            <span>Execução<strong>{run.execution?.status === "COMPLETED" ? "✓ concluída" : run.execution?.status === "RUNNING" ? "Trabalhando" : "Aguardando"}</strong></span>
            <span>Entrega<strong>{run.deliverable ? `${run.deliverable.summary} — ${run.deliverable.verificationStatus === "PASS" ? "✓ verificada" : "Aguardando verificação"}` : "Ainda não preparada"}</strong></span>
            <span>Submissão<strong>{["AWAITING_SETTLEMENT", "COMPLETED"].includes(run.state) ? "✓ enviada" : run.state === "AWAITING_SUBMISSION_APPROVAL" ? "Aguardando sua aprovação" : "Aguardando"}</strong></span>
            <span>Pagamento<strong>{run.settlement ? "Evidência registrada" : "Aguardando pagamento"}</strong></span>
            <span>Receita realizada<strong>{formatUsd(run.fixture ? 0 : run.realizedRewardUsd)}</strong></span>
          </div>
          {run.sourceUrl ? <a className="secondary-link" href={run.sourceUrl} target="_blank" rel="noopener noreferrer">Abrir oportunidade</a> : null}
          {run.state === "MANUAL_APPLICATION_REQUIRED" || run.state === "MANUAL_SUBMISSION_REQUIRED" ? <><p>{run.state === "MANUAL_APPLICATION_REQUIRED" ? "Candidatura autorizada. Este marketplace ainda não possui envio automático. Abra o marketplace e envie a candidatura manualmente." : "Entrega autorizada. Abra o marketplace e envie a entrega manualmente."}</p><EvidenceForm workRunId={run.id} kind={run.state === "MANUAL_APPLICATION_REQUIRED" ? "confirmApplication" : "confirmSubmission"} /></> : null}
          {!run.fixture && run.state === "AWAITING_SETTLEMENT" ? <EvidenceForm workRunId={run.id} kind="recordSettlement" /> : null}
        </article>) : <EmptyState title="Nenhum trabalho econômico" detail="Prepare uma candidatura em Oportunidades para começar." />}
      </Panel>
    </DashboardShell>
  );
}

function workState(state: string) { const labels: Record<string, string> = { APPLICATION_SENT: "Candidatura enviada", MANUAL_APPLICATION_REQUIRED: "Envio manual necessário", MANUAL_SUBMISSION_REQUIRED: "Entrega manual necessária", AWAITING_APPLICATION_APPROVAL: "Esperando sua aprovação", AWAITING_SUBMISSION_APPROVAL: "Esperando aprovação da entrega", AWAITING_SETTLEMENT: "Aguardando pagamento", COMPLETED: "Trabalho concluído", EXECUTING: "Trabalhando", WORK_READY: "Entrega preparada" }; return labels[state] ?? "Preparando trabalho"; }
