"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function LiveStatus() {
  const [status, setStatus] = useState({ global: "STARTING", label: "Starting", detail: "Checking runtime..." });
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/control/health", { cache: "no-store" });
        const data = await response.json();
        if (active) setStatus(data.status);
      } catch {
        if (active) setStatus({ global: "OFFLINE", label: "Offline", detail: "Beyonder is not running." });
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); router.refresh(); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [router]);

  const tone = status.global === "READY" ? "good" : status.global === "WORKING" ? "info" : status.global === "WAITING_FOR_YOU" || status.global === "PAUSED" ? "warn" : status.global === "ATTENTION_REQUIRED" || status.global === "OFFLINE" ? "bad" : "neutral";
  const active = status.global === "WORKING" || status.global === "STARTING";

  return (
    <div className={`runtime-state runtime-${tone}`} role="status" aria-live="polite">
      <span className={`runtime-indicator${active ? " runtime-indicator-active" : ""}`} aria-hidden="true" />
      <span className="runtime-label">{status.label}</span>
      <span className="runtime-detail">{status.detail}</span>
    </div>
  );
}
