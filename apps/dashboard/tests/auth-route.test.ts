import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("../control/commands", () => ({ runControlCommand: vi.fn(async () => ({ ok: true })), queueControlObjective: vi.fn(), markShutdownResponseSent: vi.fn() }));
import { POST } from "../app/api/control/command/route";
import { getAuthToken } from "../control/security";
import { runControlCommand } from "../control/commands";
const request = (type: string, token?: string) => new NextRequest("http://localhost:4187/api/control/command", { method: "POST", headers: { host: "localhost:4187", "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ type }) });
describe("command authentication boundary", () => {
  it("protects every command before dispatch, including resume/discovery/shutdown and removed bootstrap", async () => {
    for (const type of ["pauseRuntime", "safeShutdown", "resumeTask", "discoverOpportunities", "getAuthToken"]) {
      for (const token of [undefined, "wrong-token"]) {
        const response = await POST(request(type, token));
        expect(response.status).toBe(401);
        expect(await response.text()).not.toContain("wrong-token");
      }
    }
    expect(runControlCommand).not.toHaveBeenCalled();
  });
  it("accepts owner token and never returns it; removed bootstrap stays unavailable", async () => {
    const token = await getAuthToken();
    const response = await POST(request("pauseRuntime", token));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(token);
    expect((await POST(request("getAuthToken", token))).status).toBe(400);
  });
});
