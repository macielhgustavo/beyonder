import { describe, expect, it, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { assertLocalRequest, getAuthToken } from "../control/security";

describe("Control Center HTTP security", () => {
  let authToken: string;

  beforeAll(async () => {
    authToken = await getAuthToken();
  });

  it("allows local same-origin commands", async () => {
    const request = new NextRequest("http://127.0.0.1:4187/api/control/command", {
      headers: { host: "127.0.0.1:4187", origin: "http://127.0.0.1:4187", authorization: `Bearer ${authToken}` }
    });
    await expect(assertLocalRequest(request)).resolves.not.toThrow();
  });

  it("denies non-local host and cross-origin mutation", async () => {
    await expect(assertLocalRequest(new NextRequest("http://example.com/api/control/command", { headers: { host: "example.com", authorization: `Bearer ${authToken}` } }))).rejects.toThrow();
    await expect(assertLocalRequest(new NextRequest("http://127.0.0.1:4187/api/control/command", {
      headers: { host: "127.0.0.1:4187", origin: "http://evil.test", authorization: `Bearer ${authToken}` }
    }))).rejects.toThrow();
  });
});

it("rejects absent and incorrect tokens without echoing them", async () => {
  for (const token of [undefined, "invalid-secret-value"]) {
    const request = new NextRequest("http://127.0.0.1:4187/api/control/command", {
      headers: { host: "127.0.0.1:4187", ...(token ? { authorization: `Bearer ${token}` } : {}) }
    });
    await expect(assertLocalRequest(request)).rejects.toMatchObject({ status: 401 });
  }
});
