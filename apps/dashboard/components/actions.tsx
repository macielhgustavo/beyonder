"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Command = Record<string, unknown> & { type: string };

export function ObjectiveBox() {
  const router = useRouter();
  const [objective, setObjective] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("Executando objetivo...");
    const result = await command({ type: "submitObjective", objective });
    setPending(false);
    setMessage(result.ok ? "Objetivo concluído. Resultado registrado em Trabalhos." : String(result.error ?? "Falha ao executar."));
    if (result.ok) {
      setObjective("");
      router.refresh();
    }
  }

  return (
    <form className="objective-box" onSubmit={submit}>
      <label htmlFor="objective">O que voce quer que o Beyonder faca?</label>
      <textarea
        id="objective"
        value={objective}
        onChange={(event) => setObjective(event.target.value)}
        placeholder="Ex: procure oportunidades de programacao que valham a pena hoje"
        rows={4}
      />
      <div className="action-row">
        <button className="primary-button" type="submit" disabled={pending || objective.trim().length < 3}>{pending ? "Executando..." : "Executar"}</button>
        {message ? <span className="inline-message">{message}</span> : null}
      </div>
    </form>
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
    setMessage(result.ok ? (result.status === "APPROVED" ? "Autorizado. Consulte Trabalhos para realizar o envio manual." : "Registrado") : String(result.error ?? "falhou"));
    if (result.ok && refresh) router.refresh();
  }

  return (
    <span className="button-stack">
      <button className={`secondary-button button-${tone}`} type="button" disabled={pending} onClick={run}>{pending ? "..." : children}</button>
      {message ? <span className="mini-message">{message}</span> : null}
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
      <button className="secondary-button" type="submit" disabled={pending || value.length === 0 || vaultPassword.length < 12}>{pending ? "Salvando..." : "Salvar"}</button>
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
    {open ? <div className="shutdown-overlay"><div className="shutdown-dialog" role="dialog" aria-modal="true" aria-labelledby="shutdown-title"><h3 id="shutdown-title">Parar Beyonder</h3><p>O Beyonder vai parar após salvar o estado atual.</p><div className="action-row"><button type="button" className="secondary-button" disabled={pending} autoFocus onClick={() => setOpen(false)}>Cancelar</button><button type="button" className="secondary-button button-danger" disabled={pending} onClick={stop}>{pending ? "Salvando..." : "Parar com segurança"}</button></div></div></div> : null}
    {message ? <span role="status">{message}</span> : null}
  </span>;
}
