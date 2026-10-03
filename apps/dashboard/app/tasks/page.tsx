import { CommandButton } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, StatusBadge, formatDuration, formatTime, formatUsd } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const source = getDashboardDataSource();
  const tasks = await source.getTasks({ limit: 50 });

  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader title="Trabalhos" eyebrow="EXECUCAO" description="Tarefas reais do TaskExecutor, com plano, resultado, modelo e custo em linguagem humana." />
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
                    <h3>{task.title}</h3>
                    <div className="task-meta">
                      <span>Modelo: {task.model && task.provider ? `${task.model} / ${task.provider}` : "nao registrado"}</span>
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
                      <span className="step-index">{index + 1}</span>
                      <div><strong>{step.label}</strong>{step.detail ? <span>{step.detail}</span> : null}</div>
                    </div>
                  ))}
                </div>
                <details className="why-box">
                  <summary>Por que?</summary>
                  <ul>{task.why.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  <div className="technical-id">Detalhes tecnicos: {task.technicalId}</div>
                </details>
              </article>
            ))}
          </div>
        ) : <EmptyState title="Nenhum trabalho ainda" detail="Digite um objetivo na Home para iniciar a primeira execucao sem terminal." />}
      </Panel>
    </DashboardShell>
  );
}
