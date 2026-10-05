import Link from "next/link";
import { CommandButton, ObjectiveBox } from "../components/actions";
import { DashboardShell } from "../components/shell";
import { EmptyState, Metric, Panel, ProvenanceNotice, StatusBadge, formatTime, formatUsd } from "../components/ui";
import { getDashboardDataSource } from "../data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const source = getDashboardDataSource();
  const home = await source.getHome();

  return (
    <DashboardShell provenance={source.provenance}>
      <header className="home-hero">
        <div className="home-heading">
          <div className="eyebrow">INICIO / OPERACOES</div>
          <h1>Control Center</h1>
          <p>Defina objetivos, acompanhe o trabalho e intervenha apenas quando uma decisao humana for realmente necessaria.</p>
        </div>
        <GlobalStatus status={home.status.global} label={home.status.label} detail={home.status.detail} />
      </header>

      <ProvenanceNotice provenance={source.provenance} />

      {home.firstRun ? (
        <Panel title="Primeira abertura" meta="health check" className="onboarding-panel">
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
        <span className="quick-actions-label">ACOES</span>
        <CommandButton payload={{ type: "discoverOpportunities" }}>Procurar oportunidades</CommandButton>
        <Link className="secondary-link" href="/tasks">Continuar trabalhos</Link>
        <Link className="secondary-link" href="/decisions">Ver decisoes pendentes</Link>
        <span className="quick-actions-spacer" />
        {home.status.global === "PAUSED"
          ? <CommandButton payload={{ type: "resumeRuntime" }}>Retomar Beyonder</CommandButton>
          : <CommandButton payload={{ type: "pauseRuntime" }} tone="danger">Pausar Beyonder</CommandButton>}
      </section>

      <section className="home-metrics" aria-label="Resumo operacional">
        <div className="metric-strip metric-strip-operational">
          <Metric label="Agora" value={home.activeTask ? "Trabalhando" : "Livre"} hint={home.activeTask?.title ?? "Nenhuma tarefa em execucao"} tone={home.activeTask ? "info" : "good"} />
          <Metric label="Precisa de voce" value={home.needsYouCount} hint={home.needsYouCount ? "decisoes aguardando" : "nada pendente"} tone={home.needsYouCount ? "warn" : "good"} />
          <Metric label="Tarefas hoje" value={home.today.completedTasks} hint="concluidas" />
        </div>
        <div className="metric-strip metric-strip-finance">
          <Metric label="Gasto real" value={formatUsd(home.today.realMoneySpentUsd)} hint="dinheiro real" />
          <Metric label="Receita real" value={formatUsd(home.today.realRevenueUsd)} tone={home.today.realRevenueUsd > 0 ? "good" : "neutral"} />
          <Metric label="Em trabalhos" value={formatUsd(home.economy.estimatedRevenueUsd ?? 0)} hint="estimada; nao recebida" />
          <Metric label="Simulada" value={formatUsd(home.today.simulatedRevenueUsd)} hint="nao e caixa real" />
        </div>
      </section>

      <div className="grid-main home-grid">
        <Panel title="Agora" meta={home.status.heartbeat} className="now-panel">
          {home.activeTask ? (
            <div className="live-card">
              <div className="live-card-kicker">TRABALHO ATIVO</div>
              <strong>{home.activeTask.title}</strong>
              <span>{home.activeTask.humanStatus}</span>
              <div className="action-row"><Link className="secondary-link" href="/tasks">Abrir trabalho</Link></div>
            </div>
          ) : (
            <EmptyState title="Beyonder esta livre" detail="Nenhuma tarefa esta sendo executada agora. Digite um objetivo acima ou procure oportunidades." />
          )}
        </Panel>

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
          ) : <EmptyState title="Nada registrado ainda" detail="O historico aparecera conforme objetivos, oportunidades e decisoes forem processados." />}
        </Panel>
      </div>
    </DashboardShell>
  );
}

function GlobalStatus({ status, label, detail }: { status: string; label: string; detail: string }) {
  const tone = status === "READY" ? "good" : status === "WORKING" ? "info" : status === "WAITING_FOR_YOU" || status === "PAUSED" ? "warn" : status === "ATTENTION_REQUIRED" ? "bad" : "neutral";
  return (
    <div className={`global-status global-status-${tone}`}>
      <div className="global-status-top">
        <span className="micro-label">ESTADO GLOBAL</span>
        <StatusBadge status={tone}>{label}</StatusBadge>
      </div>
      <span>{detail}</span>
    </div>
  );
}
