import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, Panel, ProvenanceNotice, StatusBadge, formatDuration, formatPercent, formatTime, formatUsd } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const source = getDashboardDataSource();
  const tasks = await source.getTasks({ limit: 50 });
  return (
    <DashboardShell provenance={source.provenance}>
      <PageHeader eyebrow="EXECUTION / TASKS" title="Tasks" description="Execution history with an inspectable path from objective through evaluation and persisted outcome." />
      <ProvenanceNotice provenance={source.provenance} />
      <Panel title="Task timeline" meta={`${tasks.length} loaded`}>
        {tasks.length ? <div className="task-list">{tasks.map((task) => <article className="task-card" key={task.id}><div className="task-summary"><div><div className="micro-label">{task.type ?? "UNCLASSIFIED"} · {task.complexity ?? "UNKNOWN"}</div><h3>{task.title}</h3><div className="task-meta"><span>{task.provider ?? "—"} / {task.model ?? "—"}</span><span>{task.attempts ?? "—"} attempts</span><span>eval {formatPercent(task.evaluation)}</span><span>{formatUsd(task.costUsd)}</span><span>{formatDuration(task.durationMs)}</span><span>{formatTime(task.createdAt)}</span></div></div><StatusBadge status={task.status === "succeeded" ? "good" : task.status === "running" ? "info" : task.status === "failed" ? "bad" : "neutral"}>{task.status.toUpperCase()}</StatusBadge></div><div className="task-flow">{task.steps.map((step, index) => <div className={`task-step task-step-${step.state}`} key={`${task.id}-${step.label}`}><div className="step-index">{String(index + 1).padStart(2, "0")}</div><div><strong>{step.label}</strong><span>{step.detail ?? "—"}</span></div></div>)}</div></article>)}</div> : <EmptyState title="No tasks available" detail="Task persistence is not yet exposed through a stable dashboard adapter. The UI handles the empty state without fabricating history." />}
      </Panel>
    </DashboardShell>
  );
}
