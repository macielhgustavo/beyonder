import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { assertLocalRequest } from "../control/security";

describe("Control Center HTTP security", () => {
  it("allows local same-origin commands", () => {
    const request = new NextRequest("http://127.0.0.1:4187/api/control/command", {
      headers: { host: "127.0.0.1:4187", origin: "http://127.0.0.1:4187" }
    });
    expect(() => assertLocalRequest(request)).not.toThrow();
  });

  it("denies non-local host and cross-origin mutation", () => {
    expect(() => assertLocalRequest(new NextRequest("http://example.com/api/control/command", { headers: { host: "example.com" } }))).toThrow();
    expect(() => assertLocalRequest(new NextRequest("http://127.0.0.1:4187/api/control/command", {
      headers: { host: "127.0.0.1:4187", origin: "http://evil.test" }
    }))).toThrow();
  });
});
