import { NextRequest } from "next/server";
import { POST } from "../app/api/control/command/route";
const base = "http://127.0.0.1:4187";
async function main() {
for (const test of [
  { host: "evil.test", origin: base, contentType: "application/json", body: { type: "pauseRuntime" } },
  { host: "127.0.0.1:4187", origin: "http://evil.test", contentType: "application/json", body: { type: "pauseRuntime" } },
  { host: "127.0.0.1:4187", origin: "", contentType: "application/json", body: { type: "pauseRuntime" } },
  { host: "127.0.0.1:4187", origin: base, contentType: "text/plain", body: { type: "pauseRuntime" } },
  { host: "127.0.0.1:4187", origin: base, contentType: "application/json", body: { type: "pauseRuntime", shell: "touch /tmp/should-never-run" } },
  { host: "127.0.0.1:4187", origin: base, contentType: "application/json", body: { type: "submitObjective", objective: false } },
  { host: "127.0.0.1:4187", origin: base, contentType: "application/json", body: { type: "setSecret", providerId: "groq", envVar: "PATH", value: "test-key", vaultPassword: "test-passphrase" } }
]) {
  const response = await POST(new NextRequest(`${base}/api/control/command`, { method: "POST", headers: { host: test.host, origin: test.origin, "content-type": test.contentType }, body: JSON.stringify(test.body) }));
  if (response.status !== 400 || (await response.json()).ok !== false || response.headers.has("access-control-allow-origin")) throw new Error("Unsafe request accepted");
}
console.log(JSON.stringify({ status: "PASS", checks: 7, monetaryCostUsd: 0 }));

}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
