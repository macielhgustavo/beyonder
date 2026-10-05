"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export function LiveStatus() {
  const [status, setStatus] = useState({ label: "Iniciando", detail: "Verificando runtime..." });
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/control/health", { cache: "no-store" });
        const data = await response.json();
        if (active) setStatus(data.status);
      } catch {
        if (active) setStatus({ label: "Offline", detail: "Beyonder nao esta em execucao." });
      }
    };

    void refresh();
    const timer = setInterval(() => {
      void refresh();
      router.refresh();
    }, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [router]);

  const tone = useMemo(() => {
    const value = `${status.label} ${status.detail}`.toLocaleLowerCase("pt-BR");
    if (value.includes("offline") || value.includes("erro") || value.includes("atencao")) return "bad";
    if (value.includes("degrad") || value.includes("paus") || value.includes("esper")) return "warn";
    if (value.includes("trabalh") || value.includes("execut")) return "info";
    return "good";
  }, [status]);

  return (
    <div className={`live-status live-status-${tone}`} role="status" aria-live="polite">
      <span className="live-indicator" aria-hidden="true" />
      <div className="live-copy">
        <strong>{status.label}</strong>
        <span>{status.detail}</span>
      </div>
    </div>
  );
}
