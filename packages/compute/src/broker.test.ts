import assert from "node:assert/strict";
import test from "node:test";
import { CredentialBroker } from "./broker.js";
import { getProviderStatus } from "./status.js";
import { getProvider } from "./catalog.js";

test("broker detects environment credentials without exposing values in summary", () => {
  const broker = new CredentialBroker({}, { GROQ_API_KEY: "secret-value" });
  assert.equal(broker.hasProviderCredential("groq"), true);
  assert.equal(broker.getSecret("groq", "GROQ_API_KEY"), "secret-value");
  assert.deepEqual(broker.redactedSummary(), { groq: ["GROQ_API_KEY:env"] });
});

test("broker detects vault credentials", () => {
  const broker = new CredentialBroker({ mistral: { MISTRAL_API_KEY: "vault-secret" } }, {});
  const mistral = getProvider("mistral");
  assert.ok(mistral);
  const status = getProviderStatus(mistral, broker);
  assert.equal(status.credentialStatus, "present-vault");
  assert.equal(status.missingEnvVars.length, 0);
});

test("account-id-and-token providers require all credential parts", () => {
  const broker = new CredentialBroker({ "cloudflare-workers-ai": { CLOUDFLARE_ACCOUNT_ID: "acct" } }, {});
  const cloudflare = getProvider("cloudflare-workers-ai");
  assert.ok(cloudflare);
  const status = getProviderStatus(cloudflare, broker);
  assert.equal(status.credentialStatus, "missing");
  assert.deepEqual(status.missingEnvVars, ["CLOUDFLARE_API_TOKEN"]);
});
