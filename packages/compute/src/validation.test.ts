import assert from "node:assert/strict";
import test from "node:test";
import { CredentialBroker } from "./broker.js";
import { getProvider } from "./catalog.js";
import { validateProvider, validateProviderDetailed } from "./validation.js";

test("validation reports auth errors without exposing credential values", async () => {
  const restore = mockFetch(new Response("unauthorized", { status: 401, statusText: "Unauthorized" }));
  try {
    const nvidia = getProvider("nvidia-nim");
    assert.ok(nvidia);
    const status = await validateProvider(nvidia, new CredentialBroker({}, { NVIDIA_NIM_API_KEY: "super-secret" }));
    assert.equal(status.validationStatus, "failed");
    assert.match(status.validationMessage ?? "", /HTTP 401 Unauthorized/);
    assert.doesNotMatch(status.validationMessage ?? "", /super-secret/);
  } finally {
    restore();
  }
});

test("validation preserves rate-limit failure as operational metadata", async () => {
  const restore = mockFetch(new Response("rate limited", {
    status: 429,
    statusText: "Too Many Requests",
    headers: { "x-ratelimit-remaining-requests": "0" }
  }));
  try {
    const nvidia = getProvider("nvidia-nim");
    assert.ok(nvidia);
    const status = await validateProvider(nvidia, new CredentialBroker({}, { NVIDIA_NIM_API_KEY: "secret" }));
    assert.equal(status.validationStatus, "failed");
    assert.match(status.validationMessage ?? "", /HTTP 429 Too Many Requests/);
  } finally {
    restore();
  }
});

test("Cloudflare validation extracts model ids from catalog result objects", async () => {
  const body = JSON.stringify({
    result: [
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
      { name: "@cf/baai/bge-base-en-v1.5" }
    ]
  });
  const restore = mockFetch(() => new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", "x-ratelimit-limit-requests": "1200" }
  }));
  try {
    const cloudflare = getProvider("cloudflare-workers-ai");
    assert.ok(cloudflare);
    const report = await validateProviderDetailed(cloudflare, new CredentialBroker({}, {
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_API_TOKEN: "secret"
    }));
    assert.equal(report.status.validationStatus, "validated");
    assert.deepEqual(report.models, ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/baai/bge-base-en-v1.5"]);
    assert.equal(report.rateLimitHeaders["x-ratelimit-limit-requests"], "1200");
  } finally {
    restore();
  }
});

function mockFetch(response: Response | (() => Response)): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async () => typeof response === "function" ? response() : response;
  return () => {
    globalThis.fetch = original;
  };
}

test("detailed validation performs one authoritative request", async () => {
  let calls = 0;
  const restore = mockFetch(() => {
    calls++;
    return calls === 1 ? new Response('{"data":[{"id":"actual-model"}]}', { headers: { "content-type": "application/json" } }) : new Response("unauthorized", { status: 401 });
  });
  try {
    const report = await validateProviderDetailed(getProvider("groq")!, new CredentialBroker({}, { GROQ_API_KEY: "fixture" }));
    assert.equal(calls, 1);
    assert.equal(report.status.validationStatus, "validated");
    assert.deepEqual(report.models, ["actual-model"]);
  } finally { restore(); }
});

test("malformed catalog cannot validate a credential", async () => {
  const restore = mockFetch(() => new Response('{"notModels":true}', { headers: { "content-type": "application/json" } }));
  try {
    const report = await validateProviderDetailed(getProvider("groq")!, new CredentialBroker({}, { GROQ_API_KEY: "fixture" }));
    assert.equal(report.status.validationStatus, "failed");
  } finally { restore(); }
});

test("validation extracts Gemini model names from the same response", async () => {
  const restore = mockFetch(() => new Response('{"models":[{"name":"models/gemini-fixture"}]}', { headers: { "content-type": "application/json" } }));
  try {
    const report = await validateProviderDetailed(getProvider("gemini")!, new CredentialBroker({}, { GEMINI_API_KEY: "fixture" }));
    assert.deepEqual(report.models, ["gemini-fixture"]);
  } finally { restore(); }
});

test("validation does not persist credential-bearing network errors", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("https://provider.test?key=SECRET"); };
  try {
    const report = await validateProviderDetailed(getProvider("gemini")!, new CredentialBroker({}, { GEMINI_API_KEY: "SECRET" }));
    assert.equal(report.status.validationStatus, "failed");
    assert.doesNotMatch(JSON.stringify(report), /SECRET/);
  } finally { globalThis.fetch = original; }
});
