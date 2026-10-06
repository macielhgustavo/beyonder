import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PinnedHttpTransport } from "./pinned-transport.js";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe("proxy-compatible pinned transport", () => {
  it.each(["report-to", "vary", "content-security-policy"])("combines repeated %s without invalid HTTP newlines while preserving separate cookies", async name => {
    const server = createServer((_request, response) => {
      response.setHeader(name, ["first", "second"]);
      response.setHeader("set-cookie", ["a=one; Path=/", "b=two; Path=/"]);
      response.end("observed");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    const transport = new PinnedHttpTransport({ proxyUrl: null }); cleanup.push(() => transport.close());
    const response = await transport.fetch({ url: url.href, method: "GET", headers: {} }, { url, address: "127.0.0.1", family: 4 });
    expect(response.headers[name]).toBe("first, second");
    expect(response.headers["set-cookie"]).toBe("a=one; Path=/\nb=two; Path=/");
  });
  it.each(["93.184.216.34", "2606:4700:4700::1111"])("CONNECT pins %s while preserving the original origin Host", async address => {
    const connections: string[] = [], requests: string[] = [];
    const server = createServer();
    server.on("connect", (request, socket) => {
      connections.push(request.url!);
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      socket.once("data", buffer => {
        requests.push(buffer.toString());
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nobserved");
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const transport = new PinnedHttpTransport({ proxyUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, timeoutMs: 1000 });
    cleanup.push(() => transport.close());
    const url = new URL("http://origin.invalid:8081/document");
    const response = await transport.fetch({ url: url.href, method: "GET", headers: { "proxy-authorization": "never-forward" } }, { url, address, family: address.includes(":") ? 6 : 4 });
    expect(response.body.toString()).toBe("observed");
    expect(connections).toEqual([`${address.includes(":") ? `[${address}]` : address}:8081`]);
    expect(requests[0]).toContain("host: origin.invalid:8081");
    expect(requests[0]).not.toContain("never-forward");
  });

  it("rejects prematurely closed chunked responses instead of presenting partial evidence", async () => {
    const server = createServer();
    server.on("connect", (_request, socket) => {
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      socket.once("data", () => socket.end("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nshort"));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const transport = new PinnedHttpTransport({ proxyUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, timeoutMs: 1000 });
    cleanup.push(() => transport.close());
    const url = new URL("http://origin.invalid/");
    await expect(transport.fetch({ url: url.href, method: "GET", headers: {} }, { url, address: "93.184.216.34", family: 4 })).rejects.toThrow(/closed before completion|aborted/);
  });
});
