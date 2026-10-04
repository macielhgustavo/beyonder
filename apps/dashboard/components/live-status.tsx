"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
export function LiveStatus() {
  const [status, setStatus] = useState({ label: "Iniciando", detail: "Verificando runtime..." });
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const response = await fetch("/api/control/health", { cache: "no-store" }); const data = await response.json(); if (active) setStatus(data.status); }
      catch { if (active) setStatus({ label: "Offline", detail: "Beyonder não está em execução." }); }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); router.refresh(); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [router]);
  return <div className="global-status" role="status"><strong>{status.label}</strong><span>{status.detail}</span></div>;
}
