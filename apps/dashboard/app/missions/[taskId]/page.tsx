import { notFound } from "next/navigation";
import { CommandButton } from "../../../components/actions";
import { DashboardShell } from "../../../components/shell";
import { MissionCard } from "../../../components/mission-card";
import { PageHeader, Panel } from "../../../components/ui";
import { getDashboardDataSource } from "../../../data";

export const dynamic = "force-dynamic";

export default async function MissionDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const source = getDashboardDataSource();
  const { taskId } = await params;
  const mission = await source.getTask(taskId);
  if (!mission) notFound();
  return <DashboardShell provenance={source.provenance}>
    <PageHeader title="Missão" eyebrow="OBJECTIVE TRACE" description="Resultado, evidência e progresso primeiro. Diagnóstico técnico permanece disponível quando necessário." />
    <MissionCard mission={mission} featured />
    {mission.canResume && mission.resumeTaskId ? <div className="action-row spaced"><CommandButton payload={{ type: "resumeTask", taskId: mission.resumeTaskId }} confirm="Retomar esta missão a partir do último checkpoint seguro? Passos concluídos não serão repetidos.">Retomar do checkpoint</CommandButton></div> : null}
    <Panel title="Caminho da missão" meta={`${mission.steps.length} etapas`}><div className="mission-step-list">{mission.steps.map((step, index) => <div className={`mission-step mission-step-${step.state}`} key={`${step.label}-${index}`}><span>{step.state === "complete" ? "✓" : step.state === "active" ? "●" : step.state === "failed" ? "!" : "○"}</span><div><strong>{step.label}</strong>{step.detail ? <p>{step.detail}</p> : null}</div></div>)}</div></Panel>
    {mission.attempts?.length ? <Panel title="Tentativas físicas" meta="diagnóstico"><div className="attempt-list">{mission.attempts.map((attempt, index) => <div key={`${attempt.phase}-${index}`}><strong>{attempt.phase}</strong><span>{attempt.provider} · {attempt.model}</span><span>{attempt.status}{attempt.failureClass ? ` · ${attempt.failureClass}` : ""}</span></div>)}</div></Panel> : null}
  </DashboardShell>;
}
