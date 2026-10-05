import Link from "next/link";
import type { TaskView } from "../data/types";
import { StatusBadge, formatDuration, formatUsd } from "./ui";

export function MissionCard({ mission, featured = false }: { mission: TaskView; featured?: boolean }) {
  const tone = mission.status === "succeeded" ? "good" : mission.status === "failed" || mission.status === "blocked" ? "bad" : mission.status === "waiting" ? "warn" : "info";
  const running = ["queued", "planning", "running"].includes(mission.status);
  return (
    <article className={`mission-card${featured ? " mission-card-featured" : ""}`}>
      <div className="mission-kicker">
        <StatusBadge status={tone}>{missionLabel(mission)}</StatusBadge>
        {running ? <span className="mission-pulse" aria-label="Em andamento" /> : null}
      </div>
      <h2>{mission.title}</h2>
      <p className="mission-state">{mission.humanStatus}</p>

      {mission.resultVerified && mission.result ? (
        <section className="mission-result" aria-label="Resultado verificado">
          <span className="micro-label">Resultado</span>
          <p>{mission.result}</p>
        </section>
      ) : mission.status === "failed" || mission.status === "blocked" ? (
        <section className="mission-problem" role="alert">
          <span className="micro-label">O que impediu a conclusão</span>
          <p>{mission.failureSummary ?? mission.humanStatus}</p>
        </section>
      ) : null}

      {mission.evidenceSources.length ? (
        <div className="mission-evidence">
          <span className="micro-label">Evidência observada · {mission.evidenceSources.length} fonte{mission.evidenceSources.length === 1 ? "" : "s"}</span>
          <div>{mission.evidenceSources.slice(0, featured ? 4 : 2).map((source) => <a key={source} href={source} target="_blank" rel="noopener noreferrer">{sourceLabel(source)}</a>)}</div>
        </div>
      ) : null}

      <dl className="mission-meta">
        <div><dt>Confiança</dt><dd>{mission.confidence === null ? "Não aferida" : `${Math.round(mission.confidence * 100)}%`}</dd></div>
        <div><dt>Inteligência</dt><dd>{mission.model && mission.provider ? `${mission.model} · ${mission.provider}` : "Ainda não selecionada"}</dd></div>
        <div><dt>Ferramenta</dt><dd>{mission.tool ?? "Nenhuma"}</dd></div>
        <div><dt>Custo real</dt><dd>{formatUsd(mission.costUsd)}</dd></div>
        <div><dt>Recursos</dt><dd>{formatUsd(mission.shadowCostUsd)}</dd></div>
        <div><dt>Tempo</dt><dd>{formatDuration(mission.durationMs)}</dd></div>
      </dl>

      <div className="mission-footer">
        {mission.taskId ? <Link className="secondary-link" href={`/missions/${encodeURIComponent(mission.taskId)}`}>Ver missão completa</Link> : null}
        <details className="mission-technical">
          <summary>Detalhes técnicos</summary>
          <div className="mission-trace">
            <span>{mission.steps.length} passos registrados</span>
            <span>{mission.attempts?.length ?? 0} tentativas físicas</span>
            <span>Estado do objetivo: {mission.objectiveStatus ?? "não verificado"}</span>
            <span>Fase: {mission.executionPhase ?? "não registrada"}</span>
            {mission.technicalId ? <code>{mission.technicalId}</code> : null}
          </div>
        </details>
      </div>
    </article>
  );
}

function missionLabel(mission: TaskView) {
  if (mission.status === "succeeded") return "Objetivo atendido";
  if (mission.status === "blocked") return mission.objectiveStatus === "NEEDS_INPUT" ? "Precisa de você" : "Capacidade necessária";
  if (mission.status === "failed") return "Não concluída";
  if (mission.status === "waiting") return "Pausada com segurança";
  if (mission.executionPhase === "EXECUTION_FINISHED") return "Verificando resultado";
  if (mission.status === "planning") return "Entendendo e planejando";
  if (mission.status === "queued") return "Missão criada";
  return "Em andamento";
}

function sourceLabel(value: string) {
  try { const url = new URL(value); return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`; }
  catch { return "Fonte observada"; }
}
