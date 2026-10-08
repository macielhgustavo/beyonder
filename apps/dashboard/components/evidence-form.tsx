"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
export function EvidenceForm({ workRunId, kind }: { workRunId: string; kind: "confirmApplication" | "confirmSubmission" | "recordSettlement" }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true);
    const form = new FormData(event.currentTarget);
    const payload = kind === "recordSettlement" ? { amount: Number(form.get("amount")), currency: form.get("currency"), source: form.get("source"), externalReference: form.get("reference") } : { externalReference: String(form.get("reference") ?? ""), notes: String(form.get("notes") ?? "") };
    try {
      const response = await fetch("/api/control/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: kind, workRunId, ...payload }) });
      const result = await response.json(); setMessage(result.ok ? "Evidência registrada." : result.error); if (result.ok) router.refresh();
    } catch { setMessage("Não foi possível registrar. Tente novamente."); } finally { setPending(false); }
  }
  return <form className="secret-form" onSubmit={submit}>
    <p>{kind === "recordSettlement" ? "Registre apenas quando houver evidência real de pagamento." : "Isso apenas registra que você realizou a ação fora do Beyonder. Não registra pagamento."}</p>
    {kind === "recordSettlement" ? <><label>Valor<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Moeda<select name="currency"><option>USD</option><option>USDC</option></select></label><label>Fonte<input name="source" required maxLength={160} /></label></> : null}
    <label>Referência externa / URL / ID<input name="reference" maxLength={1000} required={kind === "recordSettlement"} /></label>
    {kind !== "recordSettlement" ? <label>Notas opcionais<input name="notes" maxLength={2000} /></label> : null}
    <button type="submit" className="secondary-button" disabled={pending}>{kind === "recordSettlement" ? "Registrar evidência de pagamento" : kind === "confirmApplication" ? "Eu enviei esta candidatura" : "Eu enviei esta entrega"}</button>
    <span role="status">{message}</span>
  </form>;
}
