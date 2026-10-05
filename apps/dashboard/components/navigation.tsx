"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  ["/", "Inicio", "01"],
  ["/tasks", "Trabalhos", "02"],
  ["/opportunities", "Oportunidades", "03"],
  ["/decisions", "Decisoes", "04"],
  ["/resources", "Recursos", "05"],
  ["/memory", "Memoria", "06"],
  ["/audit", "Historico", "07"],
  ["/settings", "Configuracoes", "08"]
] as const;

export function PrimaryNavigation() {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Navegacao principal">
      {items.map(([href, label, index]) => {
        const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} className={`nav-link${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}>
            <span className="nav-index">{index}</span>
            <span className="nav-label">{label}</span>
            <span className="nav-active-mark" aria-hidden="true" />
          </Link>
        );
      })}
    </nav>
  );
}
