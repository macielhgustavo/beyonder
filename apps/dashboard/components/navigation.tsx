"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type NavItem = readonly [href: string, label: string];
type NavGroup = { readonly label: string; readonly items: readonly NavItem[] };

const groups: readonly NavGroup[] = [
  {
    label: "Operate",
    items: [
      ["/", "Command"],
      ["/missions", "Missions"],
      ["/decisions", "Decisions"]
    ]
  },
  {
    label: "Economic",
    items: [
      ["/opportunities", "Opportunities"],
      ["/tasks", "Work"]
    ]
  },
  {
    label: "System",
    items: [
      ["/resources", "Resources"],
      ["/memory", "Memory"],
      ["/audit", "History"],
      ["/settings", "Settings"]
    ]
  }
];

function activeFor(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const items: readonly NavItem[] = groups.flatMap((group) => group.items);
  const activeHref = items.find(([href]) => activeFor(pathname, href))?.[0] ?? "/";

  return (
    <>
      <nav className="nav nav-desktop" aria-label="Primary navigation">
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map(([href, label]) => {
              const active = activeFor(pathname, href);
              return (
                <Link key={href} href={href} className={`nav-link${active ? " nav-link-active" : ""}`} aria-current={active ? "page" : undefined}>
                  <span className="nav-rail" aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="nav-mobile-wrap">
        <label htmlFor="mobile-nav">View</label>
        <select id="mobile-nav" className="nav-mobile" value={activeHref} onChange={(event) => router.push(event.target.value)}>
          {groups.map((group) => (
            <optgroup label={group.label} key={group.label}>
              {group.items.map(([href, label]) => <option value={href} key={href}>{label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
    </>
  );
}
