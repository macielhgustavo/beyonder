import { DashboardShell } from "../../components/shell";
import { MissionCard } from "../../components/mission-card";
import { EmptyState, PageHeader } from "../../components/ui";
import { getDashboardDataSource } from "../../data";

export const dynamic = "force-dynamic";

export default async function MissionsPage() {
  const source = getDashboardDataSource();
  const missions = await source.getTasks({ limit: 80 });
  return <DashboardShell provenance={source.provenance}>
    <PageHeader title="Missões" eyebrow="OBJECTIVES" description="Cada pedido do operador, do entendimento inicial à verificação do resultado. Trabalho econômico aparece separadamente em Work." />
    {missions.length ? <div className="mission-list">{missions.map((mission) => <MissionCard key={mission.taskId ?? mission.technicalId ?? mission.id} mission={mission} />)}</div> : <EmptyState title="Nenhuma missão ainda" detail="Volte ao Início e descreva o que você quer que o Beyonder faça." />}
  </DashboardShell>;
}
