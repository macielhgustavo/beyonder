"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="standalone-state"><strong>Control Center nao conseguiu carregar.</strong><span>O runtime local permanece protegido; tente recarregar.</span><button onClick={() => reset()}>Tentar novamente</button></div>;
}
