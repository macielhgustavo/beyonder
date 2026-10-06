"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { TaskView } from "../data/types";
import { MissionCard } from "./mission-card";

type Command = Record<string, unknown> & { type: string };

export function ObjectiveBox({ initialMission = null }: { initialMission?: TaskView | null }) {
  const router = useRouter();
  const [objective, setObjective] = useState("");
  const initialTerminal = Boolean(initialMission && ["succeeded", "failed", "blocked", "cancelled"].includes(initialMission.status)
    && initialMission.completedAt && initialMission.objectiveStatus && initialMission.executionPhase !== "EXECUTING");
  const [pending, setPending] = useState(Boolean(initialMission && !initialTerminal));
  const [message, setMessage] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(initialTerminal ? null : initialMission?.taskId ?? null);
  const [mission, setMission] = useState<TaskView | null>(initialMission);
  const [submittedObjective, setSubmittedObjective] = useState<string | null>(initialMission?.title ?? null);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/control/missions/${encodeURIComponent(taskId)}`, { cache: "no-store" });
        const payload = await response.json() as { ok?: boolean; mission?: TaskView };
        if (cancelled || !payload.ok || !payload.mission) return;
        setMission(payload.mission);
        if (["succeeded", "failed", "blocked", "cancelled"].includes(payload.mission.status)
          && payload.mission.objectiveStatus && payload.mission.completedAt && payload.mission.executionPhase !== "EXECUTING") {
          setTaskId(null);
          setPending(false);
          setMessage(null);
          router.refresh();
        }
      } catch { /* The next poll may recover after a local restart. */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [taskId, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMission(null);
    setMessage("Criando missão…");
    const result = await command({ type: "submitObjective", objective });
    if (result.ok && typeof result.taskId === "string") {
      setSubmittedObjective(objective.trim());
      setTaskId(result.taskId);
      setMessage("Missão criada. Aguardando o primeiro estado persistido…");
      setObjective("");
    } else {
      setPending(false);
      setMessage(String(result.error ?? "Não foi possível criar a missão."));
    }
  }

  return (
    <section className={`command-surface${pending || mission ? " command-surface-engaged" : ""}`} aria-label="Command Beyonder">
      <div className="command-surface-head">
        <div>
          <span className="eyebrow">COMMAND</span>
          <h2>O que precisa ser feito?</h2>
        </div>
        <span className="command-hint">objetivo → execução → resultado</span>
      </div>
      <form className="objective-box" onSubmit={submit}>
        <label className="sr-only" htmlFor="objective">O que você quer que o Beyonder faça?</label>
        <textarea
          id="objective"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="Descreva um objetivo concreto…"
          rows={3}
        />
        <div className="objective-footer">
          <span className="objective-help">Beyonder cria uma missão persistente e verifica o resultado antes de declarar sucesso.</span>
          <button className="primary-button" type="submit" disabled={pending || objective.trim().length < 3}>
            {pending ? "Executando" : "Iniciar missão"}
          </button>
        </div>
        {message ? <div className="command-progress" role="status" aria-live="polite"><span className="mission-pulse" /><span>{message}</span></div> : null}
      </form>
      {mission ? <div className="command-mission"><MissionCard mission={mission} featured /></div> : pending && submittedObjective ? (
        <div className="mission-launching" aria-live="polite">
          <span className="mission-pulse" />
          <div><strong>{submittedObjective}</strong><span>Preparando a primeira leitura persistida da missão…</span></div>
        </div>
      ) : null}
    </section>
  );
}

export function CommandButton({ children, payload, tone = "default", confirm, refresh = true }: { children: ReactNode; payload: Command; tone?: "default" | "danger" | "quiet"; confirm?: string; refresh?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setPending(true);
    const result = await command(payload);
    setPending(false);
    setMessage(result.ok ? (result.status === "APPROVED" ? "Autorizado. Consulte Work para realizar o envio manual." : "Registrado") : String(result.error ?? "Falhou"));
    if (result.ok && refresh) router.refresh();
  }

  return (
    <span className="button-stack">
      <button className={`secondary-button button-${tone}`} data-command={payload.type} type="button" disabled={pending} onClick={run}>{pending ? "Processando…" : children}</button>
      {message ? <span className="mini-message" role="status">{message}</span> : null}
    </span>
  );
}

export function SecretForm({ providerId, envVar }: { providerId: string; envVar: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [vaultPassword, setVaultPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await command({ type: "setSecret", providerId, envVar, value, vaultPassword });
    setPending(false);
    setValue("");
    setVaultPassword("");
    setMessage(result.ok ? (result.status === "READY" ? "Credencial validada. Disponível nesta sessão." : "Chave salva, mas não validada. Verifique a chave e a conexão.") : String(result.error ?? "Falha ao configurar."));
    if (result.ok) router.refresh();
  }

  return (
    <form className="secret-form" onSubmit={submit}>
      <label>{envVar}</label>
      <input type="password" value={value} onChange={(event) => setValue(event.target.value)} placeholder="API key" autoComplete="off" />
      <input type="password" value={vaultPassword} onChange={(event) => setVaultPassword(event.target.value)} placeholder="Vault password" autoComplete="off" />
      <button className="secondary-button" type="submit" disabled={pending || value.length === 0 || vaultPassword.length < 12}>{pending ? "Salvando…" : "Salvar"}</button>
      {message ? <span className="mini-message">{message}</span> : null}
    </form>
  );
}

async function command(payload: Command): Promise<Record<string, unknown> & { ok?: boolean; error?: unknown }> {
  const response = await fetch("/api/control/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return await response.json() as Record<string, unknown> & { ok?: boolean; error?: unknown };
}

export function ShutdownButton() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function stop() {
    setPending(true);
    try {
      const result = await command({ type: "safeShutdown" });
      setMessage(result.ok ? "Parada solicitada. O painel ficará offline após salvar o estado." : String(result.error ?? "Falha ao parar."));
      if (result.ok) setOpen(false);
    } catch { setMessage("Não foi possível solicitar a parada."); } finally { setPending(false); }
  }
  return <span className="button-stack">
    <button type="button" className="secondary-button button-danger" onClick={() => setOpen(true)}>Parar Beyonder</button>
    {open ? <div className="shutdown-overlay"><div className="shutdown-dialog" role="dialog" aria-modal="true" aria-labelledby="shutdown-title"><h3 id="shutdown-title">Parar Beyonder</h3><p>O Beyonder vai parar após salvar o estado atual.</p><div className="action-row"><button type="button" className="secondary-button" disabled={pending} autoFocus onClick={() => setOpen(false)}>Cancelar</button><button type="button" className="secondary-button button-danger" disabled={pending} onClick={stop}>{pending ? "Salvando…" : "Parar com segurança"}</button></div></div></div> : null}
    {message ? <span role="status">{message}</span> : null}
  </span>;
}
