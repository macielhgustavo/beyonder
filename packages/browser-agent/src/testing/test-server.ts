import { createServer, type Server } from "node:http";

export interface BrowserTestServer {
  baseUrl: string;
  getPostCount(): number;
  close(): Promise<void>;
}

export async function startBrowserTestServer(): Promise<BrowserTestServer> {
  let postCount = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/save") {
      postCount += 1;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(page("Saved", "<h1>Saved</h1>"));
      return;
    }
    if (url.pathname === "/redirect") {
      response.writeHead(302, { location: "/final" });
      response.end();
      return;
    }
    if (url.pathname === "/docs") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(page("Documentation", '<h1>Documentation</h1><p id="docs-copy">Deterministic browser documentation page.</p>'));
      return;
    }
    if (url.pathname === "/final") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(page("Redirect complete", "<h1>Redirect complete</h1>"));
      return;
    }
    if (url.pathname === "/slow") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        page(
          "Slow element",
          '<h1>Slow</h1><div id="mount"></div><script>setTimeout(()=>{const b=document.createElement("button");b.textContent="Ready";document.getElementById("mount").appendChild(b)},150)</script>'
        )
      );
      return;
    }
    if (url.pathname === "/duplicate-text") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        page(
          "Duplicate text",
          '<h1>Download Python for Any OS</h1><p>Download Python — Latest stable release: Python 3.14.8</p>'
        )
      );
      return;
    }
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        page(
          "Beyonder Browser Fixture",
          `
            <h1>Browser fixture</h1>
            <button type="button" aria-label="Documentation" onclick="location.href='/docs'">Documentation</button>
            <label>Search <input name="search" placeholder="Search docs"></label>
            <button type="button" onclick="document.getElementById('echo').textContent=document.querySelector('[name=search]').value">Echo search</button>
            <p id="echo"></p>
            <a href="/redirect">Redirect</a>
            <a href="/slow">Slow page</a>
            <form method="post" action="/save">
              <button type="submit">Save changes</button>
            </form>
            <form method="post" action="/save">
              <button type="submit">Purchase</button>
            </form>
          `
        )
      );
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind browser test server.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    getPostCount: () => postCount,
    close: () => closeServer(server)
  };
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
