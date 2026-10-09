import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Production exports intentionally target tsc output. Tests exercise workspace
// source, including exported subpaths, without a previous build. Derive every
// exact mapping from the same manifests instead of maintaining a package list.
const workspaceSourceAliases = readdirSync(resolve(__dirname, "packages")).flatMap(directory => {
  const root = resolve(__dirname, "packages", directory);
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const exports: Record<string, string> = manifest.exports ?? { ".": manifest.main };
  return Object.entries(exports).map(([subpath, target]) => {
    const source = resolve(root, target.replace(/^\.\/dist\//, "./src/").replace(/\.js$/, ".ts"));
    if (!existsSync(source)) throw new Error(`Missing workspace source for ${manifest.name}${subpath}: ${source}`);
    const name = manifest.name + (subpath === "." ? "" : subpath.slice(1));
    return { find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), replacement: source };
  });
});

export default defineConfig({ resolve: { alias: workspaceSourceAliases } });
