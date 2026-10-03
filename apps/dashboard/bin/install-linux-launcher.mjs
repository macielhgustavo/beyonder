#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname);
const desktopPath = join(homedir(), ".local/share/applications/beyonder-control-center.desktop");
const exec = `bash -lc 'cd ${shellQuote(repoRoot)} && pnpm control-center:launch'`;

const desktop = `[Desktop Entry]
Type=Application
Name=Beyonder
Comment=Open the local Beyonder Control Center
Exec=${exec}
Terminal=false
Categories=Development;Utility;
StartupNotify=true
`;

mkdirSync(dirname(desktopPath), { recursive: true });
writeFileSync(desktopPath, desktop, { mode: 0o644 });
console.log(`Installed ${desktopPath}`);

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
