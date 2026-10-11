import Link from "next/link";
import type { TaskView } from "../data/types";
import { StatusBadge, formatDuration, formatTime, formatUsd } from "./ui";

export function MissionCard({ mission, featured = false }: { mission: TaskView; featured?: boolean }) {
  const tone = mission.status === "succeeded" ? "good" : mission.status === "failed" || mission.status === "blocked" ? "bad" : mission.status === "waiting" ? "warn" : "info";
  const running = ["queued", "planning", "running"].includes(mission.status);
  const activeStep = mission.steps.find((step) => step.state === "active");
  const needsInput = mission.status === "blocked" && mission.objectiveStatus === "NEEDS_INPUT";

  return (
    <article
      className={`mission-card${featured ? " mission-card-featured" : ""}${needsInput ? " mission-card-needs-input" : ""}`}
      data-mission-id={mission.taskId}
      data-state={mission.status}
      data-objective-status={mission.objectiveStatus}
      data-execution-phase={mission.executionPhase}
      data-result-verified={mission.resultVerified}
    >
      <div className="mission-primary">
        <div className="mission-kicker">
          <StatusBadge status={tone}>{missionLabel(mission)}</StatusBadge>
          {running ? <span className="mission-pulse" aria-label="Em andamento" /> : null}
          <span className="mission-time">{mission.completedAt ? `concluída ${formatTime(mission.completedAt)}` : mission.startedAt ? `iniciada ${formatTime(mission.startedAt)}` : "tempo não registrado"}</span>
        </div>
        <h2>{mission.title}</h2>
        <p className="mission-state">{mission.humanStatus}</p>
      </div>

      {running ? (
        <div className="mission-live" aria-label="Execução atual">
          <div className="mission-live-mark"><span className="mission-pulse" /></div>
          <div>
            <span className="micro-label">Agora</span>
            <strong>{activeStep?.label ?? liveLabel(mission)}</strong>
            {activeStep?.detail ? <p>{activeStep.detail}</p> : null}
          </div>
          {mission.tool ? <span className="mission-live-tool">tool · {mission.tool}</span> : null}
        </div>
      ) : null}

      {mission.resultVerified && mission.result ? (
        <section className="mission-result" aria-label="Resultado verificado">
          <span className="micro-label">Resultado verificado</span>
          <p>{mission.result}</p>
        </section>
      ) : mission.status === "failed" || mission.status === "blocked" ? (
        <section className="mission-problem" role="alert">
          <span className="micro-label">{needsInput ? "Precisa de você" : "O que impediu a conclusão"}</span>
          <p>{mission.failureSummary ?? mission.humanStatus}</p>
        </section>
      ) : null}

      {mission.evidenceSources.length ? (
        <div className="mission-evidence">
          <span className="micro-label">Evidência · {mission.evidenceSources.length} fonte{mission.evidenceSources.length === 1 ? "" : "s"}</span>
          <div>{mission.evidenceSources.slice(0, featured ? 5 : 2).map((source) => <a key={source} href={source} target="_blank" rel="noopener noreferrer">{sourceLabel(source)}</a>)}</div>
        </div>
      ) : mission.resultVerified ? <div className="mission-evidence-empty">Resultado verificado sem fonte externa registrada.</div> : null}

      <dl className="mission-summary-meta">
        <div><dt>Confiança</dt><dd>{mission.confidence === null ? "Não aferida" : `${Math.round(mission.confidence * 100)}%`}</dd></div>
        <div><dt>Evidência</dt><dd>{mission.evidenceSources.length ? `${mission.evidenceSources.length} fonte${mission.evidenceSources.length === 1 ? "" : "s"}` : "Nenhuma fonte"}</dd></div>
        <div><dt>Tempo</dt><dd>{formatDuration(mission.durationMs)}</dd></div>
        <div><dt>Custo real</dt><dd>{formatUsd(mission.costUsd)}</dd></div>
      </dl>

      <div className="mission-footer">
        {mission.taskId ? <Link className="secondary-link" href={`/missions/${encodeURIComponent(mission.taskId)}`}>{featured ? "Abrir trace completo" : "Abrir missão"}</Link> : <span />}
        <details className="mission-technical">
          <summary>Detalhes técnicos</summary>
          <div className="mission-trace">
            <span>provider · {mission.provider ?? "não selecionado"}</span>
            <span>model · {mission.model ?? "não selecionado"}</span>
            <span>tool · {mission.tool ?? "nenhuma"}</span>
            <span>{mission.steps.length} passos · {mission.attempts?.length ?? 0} tentativas</span>
            <span>objective · {mission.objectiveStatus ?? "não verificado"}</span>
            <span>phase · {mission.executionPhase ?? "não registrada"}</span>
            <span>resource cost · {formatUsd(mission.shadowCostUsd)}</span>
            {mission.technicalId ? <code>{mission.technicalId}</code> : null}
          </div>
        </details>
      </div>
    </article>
  );
}

function liveLabel(mission: TaskView) {
  if (mission.executionPhase === "EXECUTION_FINISHED") return "Verificando resultado";
  if (mission.status === "planning") return "Entendendo e planejando";
  if (mission.status === "queued") return "Aguardando execução";
  if (mission.current) return mission.current;
  return mission.humanStatus;
}

function missionLabel(mission: TaskView) {
  if (mission.status === "succeeded") return "Objetivo atendido";
  if (mission.status === "blocked") return mission.objectiveStatus === "NEEDS_INPUT" ? "Precisa de você" : "Bloqueada";
  if (mission.status === "failed") return "Não concluída";
  if (mission.status === "cancelled") return "Cancelada";
  if (mission.status === "waiting") return "Pausada com segurança";
  if (mission.executionPhase === "EXECUTION_FINISHED") return "Verificando resultado";
  if (mission.status === "planning") return "Planejando";
  if (mission.status === "queued") return "Na fila";
  return "Em andamento";
}

function sourceLabel(value: string) {
  try { const url = new URL(value); return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`; }
  catch { return "Fonte observada"; }
}
