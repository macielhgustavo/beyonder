#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const launcher = fileURLToPath(new URL("./launch-control-center.mjs", import.meta.url));
const quote = (value) => `"${value.replaceAll("%", "%%").replace(/[\\"`$]/g, "\\$&")}"`;
const desktopPath = join(homedir(), ".local/share/applications/beyonder-control-center.desktop");
mkdirSync(dirname(desktopPath), { recursive: true });
writeFileSync(desktopPath, `[Desktop Entry]\nType=Application\nName=Beyonder\nComment=Open the local Beyonder Control Center\nExec=${quote(process.execPath)} ${quote(launcher)}\nTerminal=false\nCategories=Development;Utility;\nStartupNotify=true\n`, { mode: 0o644 });
console.log(`Installed ${desktopPath}`);
