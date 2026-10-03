import { describe, expect, it } from "vitest";
import { REDACTED, redactTelemetryDetails, redactUrl } from "./redaction.js";

describe("browser telemetry redaction", () => {
  it("redacts secret-shaped keys recursively", () => {
    expect(
      redactTelemetryDetails({
        password: "hunter2",
        nested: { authorization: "Bearer abc", cookie: "sid=123", safe: "ok" }
      })
    ).toEqual({ password: REDACTED, nested: { authorization: REDACTED, cookie: REDACTED, safe: "ok" } });
  });

  it("redacts sensitive URL query parameters and fragments", () => {
    const redacted = redactUrl("https://user:pass@example.com/path?token=abc&q=docs#secret-fragment");
    expect(redacted).not.toContain("user");
    expect(redacted).not.toContain("pass");
    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("secret-fragment");
    expect(redacted).toContain("q=docs");
  });
});
