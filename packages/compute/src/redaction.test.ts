import assert from "node:assert/strict";
import test from "node:test";
import { redact } from "./redaction.js";

test("redaction removes common API key shapes", () => {
  const text = "GROQ_API_KEY=sk-abcdefghijklmnopqrstuvwxyz and Authorization: Bearer abcdefghijklmnopqrstuvwxyz";
  const redacted = redact(text);
  assert.doesNotMatch(redacted, /abcdefghijklmnopqrstuvwxyz/);
  assert.match(redacted, /\[REDACTED\]/);
});
