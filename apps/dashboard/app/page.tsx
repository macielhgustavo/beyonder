import Link from "next/link";
import { CommandButton, ObjectiveBox } from "../components/actions";
import { DashboardShell } from "../components/shell";
import { EmptyState, Panel, ProvenanceNotice, StatusBadge, formatTime, formatUsd } from "../components/ui";
import { getDashboardDataSource } from "../data";
import { MissionCard } from "../components/mission-card";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const source = getDashboardDataSource();
  const home = await source.getHome();

  return (
    <DashboardShell provenance={source.provenance}>
      <header className="home-command-header">
        <div>
          <div className="eyebrow">OPERATOR COMMAND</div>
          <h1>Control Center</h1>
          <p>Defina um objetivo, acompanhe a execução real e receba o resultado com evidência no mesmo lugar.</p>
        </div>
        <div className="home-header-actions">
          <Link className="quiet-link" href="/missions">Todas as missões</Link>
          {home.status.global === "PAUSED"
            ? <CommandButton payload={{ type: "resumeRuntime" }}>Retomar runtime</CommandButton>
            : <CommandButton payload={{ type: "pauseRuntime" }} tone="quiet">Pausar runtime</CommandButton>}
        </div>
      </header>

      <ProvenanceNotice provenance={source.provenance} />

      <ObjectiveBox initialMission={home.activeTask} />

      {home.firstRun ? (
        <Panel title="Primeira abertura" meta="health check" className="first-run-panel first-run-panel-secondary">
          <div className="health-grid">
            {home.healthChecks.map((check) => (
              <div className="health-item" key={check.label}>
                <StatusBadge status={check.status === "pass" ? "good" : check.status === "warn" ? "warn" : "bad"}>{check.label}</StatusBadge>
                <span>{check.detail}</span>
              </div>
            ))}
          </div>
          <div className="action-row spaced"><CommandButton payload={{ type: "completeFirstRun" }}>Concluir verificação inicial</CommandButton></div>
        </Panel>
      ) : null}

      <section className="operator-context" aria-label="Resumo operacional">
        <div className={home.needsYouCount ? "operator-context-item context-attention" : "operator-context-item"}>
          <span>Precisa de você</span><strong>{home.needsYouCount}</strong><small>{home.needsYouCount ? "decisões aguardando" : "nenhuma intervenção"}</small>
        </div>
        <div className="operator-context-item"><span>Verificadas hoje</span><strong>{home.today.completedTasks}</strong><small>missões concluídas</small></div>
        <div className="operator-context-item"><span>Gasto real hoje</span><strong>{formatUsd(home.today.realMoneySpentUsd)}</strong><small>dinheiro real</small></div>
        <div className="operator-context-item"><span>Receita real hoje</span><strong>{formatUsd(home.today.realRevenueUsd)}</strong><small>caixa realizado</small></div>
      </section>

      {home.activeTask ? (
        <section className="home-active">
          <div className="section-heading section-heading-strong">
            <div><span className="eyebrow">ACTIVE MISSION</span><h2>Em execução agora</h2></div>
            <Link className="secondary-link" href="/missions">Fila de missões</Link>
          </div>
          <MissionCard mission={home.activeTask} featured />
        </section>
      ) : null}

      <section className="home-utility-bar" aria-label="Ações operacionais">
        <div><span className="eyebrow">NEXT ACTION</span><strong>Discovery econômico fica separado de missões comuns.</strong></div>
        <div className="action-row">
          <CommandButton payload={{ type: "discoverOpportunities" }}>Procurar oportunidades</CommandButton>
          <Link className="secondary-link" href="/decisions">Decisões pendentes</Link>
        </div>
      </section>

      {home.recentMissions.length ? (
        <section className="home-recent">
          <div className="section-heading"><div><span className="eyebrow">RECENT</span><h2>Missões recentes</h2></div><Link className="quiet-link" href="/missions">Ver todas</Link></div>
          <div className="mission-list mission-list-compact">{home.recentMissions.slice(0, 4).map((mission) => <MissionCard key={mission.taskId ?? mission.technicalId ?? mission.id} mission={mission} />)}</div>
        </section>
      ) : null}

      <div className="grid-main home-lower-grid">
        <Panel title="Atividade recente" meta="audit">
          {home.recentAudit.length ? (
            <div className="event-list">
              {home.recentAudit.map((event) => (
                <div className="event-row" key={event.id}>
                  <span className={`event-level level-${event.level}`}>{event.level}</span>
                  <div><strong>{event.humanEvent}</strong><span>{formatTime(event.createdAt)}</span></div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Nada registrado ainda" detail="A atividade aparecerá conforme missões, oportunidades e decisões forem processadas." />}
        </Panel>
        <Panel title="Economia" meta="verdade contábil">
          <div className="economy-lines">
            <div><span>Em trabalhos</span><strong>{home.economy.estimatedRevenueUsd === undefined ? "—" : formatUsd(home.economy.estimatedRevenueUsd)}</strong><small>estimado; não é receita realizada</small></div>
            <div><span>Receita simulada</span><strong>{formatUsd(home.today.simulatedRevenueUsd)}</strong><small>não é caixa real</small></div>
          </div>
        </Panel>
      </div>
    </DashboardShell>
  );
}
