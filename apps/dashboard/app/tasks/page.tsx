import { EvidenceForm } from "../../components/evidence-form";
import { CommandButton } from "../../components/actions";
import { DashboardShell } from "../../components/shell";
import { EmptyState, PageHeader, StatusBadge, formatUsd } from "../../components/ui";
import { getDashboardDataSource } from "../../data";
import type { WorkRunView } from "../../data/types";

export const dynamic = "force-dynamic";

export default async function WorkPage() {
  const source = getDashboardDataSource();
  const runs = await source.getWorkRuns();
  const attention = runs.filter((run) => ["MANUAL_APPLICATION_REQUIRED", "MANUAL_SUBMISSION_REQUIRED", "AWAITING_APPLICATION_APPROVAL", "AWAITING_SUBMISSION_APPROVAL"].includes(run.state)).length;

  return <DashboardShell provenance={source.provenance}>
    <PageHeader
      title="Work"
      eyebrow="ECONOMIC LIFECYCLE"
      description="Trabalhos econômicos efetivamente iniciados. Missões comuns nunca aparecem aqui."
      right={<div className="action-row"><CommandButton payload={{ type: "pauseRuntime" }} tone="quiet">Pausar</CommandButton><CommandButton payload={{ type: "resumeRuntime" }}>Retomar</CommandButton></div>}
    />

    <div className="page-facts work-page-facts">
      <span><strong>{runs.length}</strong> work runs</span>
      <span className={attention ? "fact-attention" : ""}><strong>{attention}</strong> precisam de ação</span>
      <span><strong>5</strong> fases econômicas</span>
    </div>

    {runs.length ? <div className="work-list-premium">{runs.map((run) => <WorkRunCard run={run} key={run.id} />)}</div> : <EmptyState title="Nenhum trabalho econômico" detail="Missions ficam em Missions. Um item aparece aqui somente depois que uma oportunidade entra no ciclo econômico real." />}
  </DashboardShell>;
}

function WorkRunCard({ run }: { run: WorkRunView }) {
  const requiresAction = ["MANUAL_APPLICATION_REQUIRED", "MANUAL_SUBMISSION_REQUIRED", "AWAITING_APPLICATION_APPROVAL", "AWAITING_SUBMISSION_APPROVAL"].includes(run.state);
  const stages = workStages(run);

  return <article className={`work-run${requiresAction ? " work-run-attention" : ""}`} data-work-run-id={run.id} data-state={run.state} data-application-status={run.application?.status}>
    <header className="work-run-head">
      <div>
        <div className="work-run-kicker"><span className="eyebrow">{run.source}</span>{run.fixture ? <span className="demo-badge inline-demo">TEST DATA</span> : null}<StatusBadge status={requiresAction ? "warn" : run.state === "COMPLETED" ? "good" : "info"}>{workState(run.state)}</StatusBadge></div>
        <h2>{run.title}</h2>
        {run.sourceUrl ? <a className="quiet-link" href={run.sourceUrl} target="_blank" rel="noopener noreferrer">Abrir oportunidade original ↗</a> : null}
      </div>
      <div className="work-value">
        <span>Reward</span>
        <strong>{run.estimatedRewardUsd === undefined ? "UNKNOWN" : formatUsd(run.estimatedRewardUsd)}</strong>
        <small>realizado · {formatUsd(run.fixture ? 0 : run.realizedRewardUsd)}</small>
      </div>
    </header>

    <div className="work-lifecycle" aria-label="Work lifecycle">
      {stages.map((stage, index) => <div className={`work-stage work-stage-${stage.state}`} key={stage.label}><span className="work-stage-index">0{index + 1}</span><span>{stage.label}</span><strong>{stage.detail}</strong></div>)}
    </div>

    {run.deliverable ? <div className="work-deliverable"><span className="micro-label">DELIVERABLE</span><strong>{run.deliverable.summary}</strong><span>{run.deliverable.verificationStatus === "PASS" ? "Verificado" : "Verificação pendente"}</span></div> : null}

    {run.state === "MANUAL_APPLICATION_REQUIRED" || run.state === "MANUAL_SUBMISSION_REQUIRED" ? (
      <section className="work-action-required">
        <div><span className="eyebrow">ACTION REQUIRED</span><strong>{run.state === "MANUAL_APPLICATION_REQUIRED" ? "A candidatura foi autorizada, mas o marketplace exige envio manual." : "A entrega foi autorizada, mas o marketplace exige submissão manual."}</strong><p>Depois da ação externa, registre a evidência para o lifecycle continuar.</p></div>
        <EvidenceForm workRunId={run.id} kind={run.state === "MANUAL_APPLICATION_REQUIRED" ? "confirmApplication" : "confirmSubmission"} />
      </section>
    ) : null}

    {!run.fixture && run.state === "AWAITING_SETTLEMENT" ? <section className="work-action-required settlement-action"><div><span className="eyebrow">SETTLEMENT</span><strong>Aguardando evidência de pagamento.</strong></div><EvidenceForm workRunId={run.id} kind="recordSettlement" /></section> : null}
  </article>;
}

function workStages(run: WorkRunView) {
  const submitted = ["AWAITING_SETTLEMENT", "COMPLETED"].includes(run.state);
  return [
    {
      label: "Application",
      state: run.application?.status === "SENT" ? "complete" : run.state === "MANUAL_APPLICATION_REQUIRED" || run.state === "AWAITING_APPLICATION_APPROVAL" ? "attention" : "pending",
      detail: run.application?.status === "SENT" ? (run.fixture || run.application.externalEvidence || run.application.mode === "AUTOMATED_REAL" ? "Sent" : "Sent · evidence missing") : run.state === "MANUAL_APPLICATION_REQUIRED" ? "Manual send" : run.state === "AWAITING_APPLICATION_APPROVAL" ? "Approval" : "Waiting"
    },
    {
      label: "Execution",
      state: run.execution?.status === "COMPLETED" ? "complete" : run.execution?.status === "RUNNING" ? "active" : "pending",
      detail: run.execution?.status === "COMPLETED" ? "Completed" : run.execution?.status === "RUNNING" ? "Running" : "Waiting"
    },
    {
      label: "Deliverable",
      state: run.deliverable?.verificationStatus === "PASS" ? "complete" : run.deliverable ? "active" : "pending",
      detail: run.deliverable?.verificationStatus === "PASS" ? "Verified" : run.deliverable ? "Verifying" : "Waiting"
    },
    {
      label: "Submission",
      state: submitted ? "complete" : run.state === "MANUAL_SUBMISSION_REQUIRED" || run.state === "AWAITING_SUBMISSION_APPROVAL" ? "attention" : "pending",
      detail: submitted ? "Submitted" : run.state === "MANUAL_SUBMISSION_REQUIRED" ? "Manual send" : run.state === "AWAITING_SUBMISSION_APPROVAL" ? "Approval" : "Waiting"
    },
    {
      label: "Settlement",
      state: run.settlement ? "complete" : run.state === "AWAITING_SETTLEMENT" ? "active" : "pending",
      detail: run.settlement ? "Evidence recorded" : run.state === "AWAITING_SETTLEMENT" ? "Awaiting payment" : "Waiting"
    }
  ];
}

function workState(state: string) {
  const labels: Record<string, string> = {
    APPLICATION_SENT: "Application sent",
    MANUAL_APPLICATION_REQUIRED: "Manual application required",
    MANUAL_SUBMISSION_REQUIRED: "Manual submission required",
    AWAITING_APPLICATION_APPROVAL: "Application approval",
    AWAITING_SUBMISSION_APPROVAL: "Submission approval",
    AWAITING_SETTLEMENT: "Awaiting settlement",
    COMPLETED: "Completed",
    EXECUTING: "Executing",
    WORK_READY: "Deliverable ready"
  };
  return labels[state] ?? "Preparing work";
}
