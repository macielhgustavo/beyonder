import Link from "next/link";
import { CommandButton, ObjectiveBox } from "../components/actions";
import { DashboardShell } from "../components/shell";
import { EmptyState, Metric, Panel, ProvenanceNotice, StatusBadge, formatTime, formatUsd } from "../components/ui";
import { getDashboardDataSource } from "../data";
import { MissionCard } from "../components/mission-card";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const source = getDashboardDataSource();
  const home = await source.getHome();

  return (
    <DashboardShell provenance={source.provenance}>
      <header className="home-hero home-hero-simple">
        <div>
          <div className="eyebrow">BEYONDER</div>
          <h1>Control Center</h1>
        </div>
      </header>

      <ProvenanceNotice provenance={source.provenance} />

      {home.firstRun ? (
        <Panel title="Primeira abertura" meta="health check">
          <div className="health-grid">
            {home.healthChecks.map((check) => (
              <div className="health-item" key={check.label}>
                <StatusBadge status={check.status === "pass" ? "good" : check.status === "warn" ? "warn" : "bad"}>{check.label}</StatusBadge>
                <span>{check.detail}</span>
              </div>
            ))}
          </div>
          <div className="action-row spaced">
            <CommandButton payload={{ type: "completeFirstRun" }}>Comecar</CommandButton>
          </div>
        </Panel>
      ) : null}

      <ObjectiveBox />

      <section className="quick-actions" aria-label="Acoes rapidas">
        <CommandButton payload={{ type: "discoverOpportunities" }}>Procurar oportunidades</CommandButton>
        <Link className="secondary-link" href="/missions">Continuar missões</Link>
        <Link className="secondary-link" href="/decisions">Ver decisoes pendentes</Link>
        {home.status.global === "PAUSED"
          ? <CommandButton payload={{ type: "resumeRuntime" }}>Retomar Beyonder</CommandButton>
          : <CommandButton payload={{ type: "pauseRuntime" }} tone="danger">Pausar Beyonder</CommandButton>}
      </section>

      <section className="metric-strip home-metrics">
        <Metric label="Precisa de voce" value={home.needsYouCount} hint={home.needsYouCount ? "decisoes aguardando" : "nada pendente"} tone={home.needsYouCount ? "warn" : "good"} />
        <Metric label="Missões hoje" value={home.today.completedTasks} hint="objetivos verificados" />
        <Metric label="Dinheiro gasto" value={formatUsd(home.today.realMoneySpentUsd)} hint="dinheiro real" />
        <Metric label="Receita real" value={formatUsd(home.today.realRevenueUsd)} />
      </section>

      {home.activeTask ? <section className="home-active"><div className="section-heading"><div><span className="eyebrow">AGORA</span><h2>Missão em andamento</h2></div><Link className="secondary-link" href="/missions">Todas as missões</Link></div><MissionCard mission={home.activeTask} featured /></section> : null}

      {home.recentMissions.length ? <section className="home-recent"><div className="section-heading"><div><span className="eyebrow">CONTINUIDADE</span><h2>Missões recentes</h2></div><Link className="secondary-link" href="/missions">Ver histórico de missões</Link></div><div className="mission-list mission-list-compact">{home.recentMissions.slice(0, 3).map((mission) => <MissionCard key={mission.taskId ?? mission.technicalId ?? mission.id} mission={mission} />)}</div></section> : null}

      <div className="grid-main home-lower-grid">
        <Panel title="Historico recente" meta="audit">
          {home.recentAudit.length ? (
            <div className="event-list">
              {home.recentAudit.map((event) => (
                <div className="event-row" key={event.id}>
                  <span className={`event-level level-${event.level}`}>{event.level}</span>
                  <div><strong>{event.humanEvent}</strong><span>{formatTime(event.createdAt)}</span></div>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Nada registrado ainda" detail="O histórico aparecerá conforme missões, oportunidades e decisões forem processadas." />}
        </Panel>
        <Panel title="Economia" meta="separação contábil"><div className="economy-lines"><div><span>Em trabalhos</span><strong>{formatUsd(home.economy.estimatedRevenueUsd ?? 0)}</strong><small>estimado, ainda não recebido</small></div><div><span>Receita simulada</span><strong>{formatUsd(home.today.simulatedRevenueUsd)}</strong><small>não é caixa real</small></div></div></Panel>
      </div>
    </DashboardShell>
  );
}
