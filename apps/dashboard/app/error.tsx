"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="standalone-state"><strong>Dashboard data could not be loaded.</strong><span>The runtime remains untouched; this control plane is read-only.</span><button onClick={() => reset()}>Retry</button></div>;
}
