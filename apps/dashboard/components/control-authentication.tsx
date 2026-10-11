"use client";
import { useState, type FormEvent } from "react";

// Memory only: never URL, HTML bootstrap, localStorage or an unauthenticated endpoint.
let sessionToken = "";
export function controlAuthHeaders(): Record<string, string> {
  return sessionToken ? { authorization: `Bearer ${sessionToken}` } : {};
}
export function ControlAuthentication() {
  const [token, setToken] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [message, setMessage] = useState("");
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await fetch("/api/control/auth", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) { setMessage("Token inválido ou indisponível."); return; }
      sessionToken = token; setToken(""); setAuthenticated(true); setMessage("");
    } catch { setMessage("Não foi possível autenticar."); }
  }
  if (authenticated) return <aside aria-label="Autenticação local">Comandos autorizados nesta aba. <button type="button" onClick={() => { sessionToken = ""; setAuthenticated(false); }}>Bloquear comandos</button></aside>;
  return <form onSubmit={authenticate} aria-label="Autenticação local">
    <label>Token local <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required /></label>
    <button type="submit">Autorizar comandos</button>
    <p>Copie o campo token de ~/.beyonder/control-center/auth-token.json. A autorização dura até recarregar esta aba.</p>
    <span role="status">{message}</span>
  </form>;
}
