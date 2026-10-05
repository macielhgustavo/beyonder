import { DashboardShell } from "../../components/shell";
import { MissionCard } from "../../components/mission-card";
import { EmptyState, PageHeader } from "../../components/ui";
import { getDashboardDataSource } from "../../data";
import type { TaskView } from "../../data/types";

export const dynamic = "force-dynamic";

export default async function MissionsPage() {
  const source = getDashboardDataSource();
  const missions = await source.getTasks({ limit: 80 });
  const ordered = [...missions].sort((a, b) => missionPriority(a) - missionPriority(b));
  const needsYou = missions.filter((mission) => mission.status === "blocked" && mission.objectiveStatus === "NEEDS_INPUT").length;
  const active = missions.filter((mission) => ["queued", "planning", "running", "waiting"].includes(mission.status)).length;
  const verified = missions.filter((mission) => mission.resultVerified && mission.status === "succeeded").length;

  return <DashboardShell provenance={source.provenance}>
    <PageHeader title="Missions" eyebrow="OBJECTIVE OPERATIONS" description="Pedidos do operador do entendimento inicial à verificação. Trabalho econômico permanece separado em Work." />
    <div className="page-facts" aria-label="Mission summary">
      <span><strong>{active}</strong> ativas</span>
      <span className={needsYou ? "fact-attention" : ""}><strong>{needsYou}</strong> precisam de você</span>
      <span><strong>{verified}</strong> verificadas</span>
      <span><strong>{missions.length}</strong> total</span>
    </div>
    {ordered.length ? <div className="mission-list mission-index">{ordered.map((mission) => <MissionCard key={mission.taskId ?? mission.technicalId ?? mission.id} mission={mission} />)}</div> : <EmptyState title="Nenhuma missão ainda" detail="Volte ao Command e descreva o que você quer que o Beyonder faça." />}
  </DashboardShell>;
}

function missionPriority(mission: TaskView) {
  if (mission.status === "blocked" && mission.objectiveStatus === "NEEDS_INPUT") return 0;
  if (["queued", "planning", "running"].includes(mission.status)) return 1;
  if (mission.status === "waiting") return 2;
  if (mission.status === "failed" || mission.status === "blocked") return 3;
  return 4;
}
