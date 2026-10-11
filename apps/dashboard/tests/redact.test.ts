import { describe, expect, it } from "vitest";
import { redactText, redactValue, safeJsonObject } from "../data/redact";

describe("dashboard redaction", () => {
  it("redacts secret-looking tokens from text", () => {
    expect(redactText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456")).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(redactText("api_key=super-secret-value-123")).toContain("[REDACTED]");
  });

  it("redacts sensitive object keys recursively", () => {
    const result = redactValue({ provider: "groq", apiKey: "secret", nested: { session_token: "secret-2", safe: "ok" } });
    expect(result).toEqual({ provider: "groq", apiKey: "[REDACTED]", nested: { session_token: "[REDACTED]", safe: "ok" } });
  });

  it("returns safe objects for malformed audit JSON", () => {
    expect(safeJsonObject("not-json")).toEqual({ parseError: true });
  });
});
