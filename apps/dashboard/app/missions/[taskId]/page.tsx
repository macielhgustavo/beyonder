import { notFound } from "next/navigation";
import { CommandButton } from "../../../components/actions";
import { DashboardShell } from "../../../components/shell";
import { MissionCard } from "../../../components/mission-card";
import { PageHeader, Panel, StatusBadge, formatTime } from "../../../components/ui";
import { getDashboardDataSource } from "../../../data";

export const dynamic = "force-dynamic";

export default async function MissionDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const source = getDashboardDataSource();
  const { taskId } = await params;
  const mission = await source.getTask(taskId);
  if (!mission) notFound();

  const needsInput = mission.status === "blocked" && mission.objectiveStatus === "NEEDS_INPUT";
  const activeStep = mission.steps.find((step) => step.state === "active");

  return <DashboardShell provenance={source.provenance}>
    <PageHeader title="Mission" eyebrow="OBJECTIVE TRACE" description="Pedido, estado, resultado e evidência primeiro. Diagnóstico técnico fica disponível sob demanda." />

    <section className="mission-detail-grid">
      <div className="mission-detail-main">
        <MissionCard mission={mission} featured />
        {mission.canResume && mission.resumeTaskId ? (
          <div className="mission-resume-callout">
            <div><span className="eyebrow">SAFE CHECKPOINT</span><strong>Esta missão pode continuar sem repetir etapas concluídas.</strong></div>
            <CommandButton payload={{ type: "resumeTask", taskId: mission.resumeTaskId }} confirm="Retomar esta missão a partir do último checkpoint seguro? Passos concluídos não serão repetidos.">Retomar do checkpoint</CommandButton>
          </div>
        ) : null}
      </div>

      <aside className="mission-brief" aria-label="Mission state summary">
        <div className="mission-brief-row"><span>Estado</span><StatusBadge status={mission.status === "succeeded" ? "good" : needsInput ? "warn" : mission.status === "failed" || mission.status === "blocked" ? "bad" : "info"}>{needsInput ? "Precisa de você" : mission.humanStatus}</StatusBadge></div>
        <div className="mission-brief-row"><span>Agora</span><strong>{activeStep?.label ?? (mission.status === "succeeded" ? "Concluída" : mission.humanStatus)}</strong></div>
        <div className="mission-brief-row"><span>Resultado</span><strong>{mission.resultVerified ? "Verificado" : mission.status === "succeeded" ? "Sem verificação registrada" : "Ainda não concluído"}</strong></div>
        <div className="mission-brief-row"><span>Evidência</span><strong>{mission.evidenceSources.length ? `${mission.evidenceSources.length} fonte${mission.evidenceSources.length === 1 ? "" : "s"}` : "Nenhuma fonte registrada"}</strong></div>
        <div className="mission-brief-row"><span>Início</span><strong>{formatTime(mission.startedAt)}</strong></div>
        <div className="mission-brief-row"><span>Fim</span><strong>{formatTime(mission.completedAt)}</strong></div>
      </aside>
    </section>

    <Panel title="Caminho da missão" meta={`${mission.steps.length} etapas`} className="mission-path-panel">
      <div className="mission-step-list">{mission.steps.map((step, index) => <div className={`mission-step mission-step-${step.state}`} key={`${step.label}-${index}`}><span>{step.state === "complete" ? "✓" : step.state === "active" ? "●" : step.state === "failed" ? "!" : "○"}</span><div><strong>{step.label}</strong>{step.detail ? <p>{step.detail}</p> : null}</div></div>)}</div>
    </Panel>

    {mission.attempts?.length ? (
      <details className="technical-panel">
        <summary><span>Execution diagnostics</span><span>{mission.attempts.length} physical attempt{mission.attempts.length === 1 ? "" : "s"}</span></summary>
        <div className="attempt-list">{mission.attempts.map((attempt, index) => <div key={`${attempt.phase}-${index}`}><strong>{attempt.phase}</strong><span>{attempt.provider} · {attempt.model}</span><span>{attempt.status}{attempt.failureClass ? ` · ${attempt.failureClass}` : ""}</span></div>)}</div>
      </details>
    ) : null}
  </DashboardShell>;
}
