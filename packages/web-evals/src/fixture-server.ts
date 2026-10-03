import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_EVAL_FIXTURE_VERSION = "v1";

export const WEB_EVAL_FIXTURES = [
  "text.html",
  "details.html",
  "form.html",
  "navigation.html",
  "extraction.html",
  "recovery.html",
  "verification.html"
] as const;

export interface FixtureServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startFixtureServer(root = fileURLToPath(new URL("../fixtures/", import.meta.url))): Promise<FixtureServer> {
  const resolvedRoot = resolve(root);
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET") {
        response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
        response.end("method not allowed");
        return;
      }

      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
      if (!WEB_EVAL_FIXTURES.includes(pathname as (typeof WEB_EVAL_FIXTURES)[number])) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("fixture not found");
        return;
      }

      const filePath = resolve(resolvedRoot, pathname);
      if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${sep}`)) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        response.end("forbidden");
        return;
      }

      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    })
  };
}
