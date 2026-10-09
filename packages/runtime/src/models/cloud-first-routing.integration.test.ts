import { fixtureZeroCost } from './testing/zero-cost-fixture.js';
import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AutopilotStateStore } from "@beyonder/compute";
import type { IntelligenceTask } from "../intelligence/contracts.js";
import { AdaptiveModelSelector } from "./adaptive-selector.js";
import { ModelRouter } from "./model-router.js";
import { loadConfig } from "../config/env.js";
import type { ModelCapabilityRequest, ModelCapabilitySource } from "./capability-source.js";
import type { QuotaSource } from "./quota.js";
import type { QuotaSnapshot } from "./adaptive-types.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

class JourneyQuotaSource implements QuotaSource {
  async get(provider: string, model?: string): Promise<QuotaSnapshot> {
    return {
      provider,
      model,
      requestsPerMinute: provider === "ollama" ? "unknown" : 60,
      requestsPerDay: provider === "ollama" ? "unknown" : 1000,
      tokensPerMinute: provider === "ollama" ? "unknown" : 100_000,
      tokensPerDay: provider === "ollama" ? "unknown" : 1_000_000,
      requestQuotaTotal: provider === "ollama" ? "unknown" : 1000,
      requestQuotaRemaining: provider === "ollama" ? "unknown" : 900,
      tokenQuotaTotal: provider === "ollama" ? "unknown" : 1_000_000,
      tokenQuotaRemaining: provider === "ollama" ? "unknown" : 900_000,
      resetAt: "unknown",
      health: provider === "ollama" ? "keyless" : "healthy",
      lastUpdatedAt: new Date().toISOString()
    };
  }
  async list(): Promise<QuotaSnapshot[]> { return []; }
}

class JourneyCapabilitySource implements ModelCapabilitySource {
  constructor(private readonly localScore: number, private readonly cloudScore = 0.94) {}
  async getCapability(input: ModelCapabilityRequest) {
    return { score: input.provider === "ollama" ? this.localScore : this.cloudScore, samples: 10, source: "BIB" as const };
  }
  async getCapabilityScore(input: ModelCapabilityRequest) {
    return (await this.getCapability(input)).score;
  }
}

function simpleTask(): IntelligenceTask {
  return { id: "simple", input: "Summarize this short static idea", type: "chat", complexity: 0.08, risk: 0.02, estimatedTokens: 180, requirements: { directResponse: true } };
}

function complexTask(): IntelligenceTask {
  return {
    id: "complex",
    input: "Compare current provider capabilities from multiple sources and synthesize the result",
    type: "research",
    complexity: 0.84,
    risk: 0.08,
    estimatedTokens: 1800,
    requirements: { browser: true, reasoning: true, toolUse: true, structuredOutput: true },
    goalContract: {
      version: 1,
      normalizedObjective: "Compare current provider capabilities from multiple sources and synthesize the result",
      primaryIntent: "COMPARISON",
      domain: "technology",
      freshness: "CURRENT",
      evidenceRequirement: "REQUIRED",
      requiredCapabilities: ["web-research", "browser-read", "comparison", "citations", "reasoning", "structured-output"],
      ambiguityLevel: "LOW",
      clarificationRequired: false,
      successCriteria: [],
      expectedResultKind: "COMPARISON",
      qualityTarget: "HIGH",
      minimumEvidenceSources: 3,
      analysisMethod: "hybrid"
    }
  };
}

async function providerStatePath() {
  const dir = await mkdtemp(join(tmpdir(), "beyonder-cloud-first-"));
  const path = join(dir, "providers.json");
  await new AutopilotStateStore(path).write({
    version: 1,
    updatedAt: new Date().toISOString(),
    providers: {
      groq: {
        providerId: "groq",
        state: "READY",
        classification: "AUTO_WITH_HUMAN_GATE",
        attempts: 1,
        lastUpdatedAt: new Date().toISOString(),
        validation: { status: "validated", models: ["llama-3.3-70b-versatile"], latencyMs: 80 }
      }
    }
  });
  return path;
}

async function ollamaServer() {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/tags") {
      response.end(JSON.stringify({ models: [{ name: "qwen3:4b" }, { name: "qwen2.5-coder:3b" }] }));
      return;
    }
    if (request.url === "/api/show") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const model = String((JSON.parse(body || "{}") as { model?: string }).model ?? "");
        response.end(JSON.stringify({ capabilities: model.includes("coder") ? ["completion", "thinking"] : ["completion", "thinking"] }));
      });
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start fake Ollama server");
  return `http://127.0.0.1:${address.port}`;
}

describe("cloud-first product routing journeys", () => {
  it("explicit local configuration cannot displace adequate free cloud or bypass the mission floor", async () => {
    const config = loadConfig({ BEYONDER_MODEL_PROVIDER: "ollama", BEYONDER_MODEL_NAME: "qwen3:4b", BEYONDER_PROVIDER_STATE_PATH: await providerStatePath(), OLLAMA_BASE_URL: await ollamaServer() });
    const router = new ModelRouter(config.model, { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model), capabilitySource: new JourneyCapabilitySource(0.48), quotaSource: new JourneyQuotaSource() });
    const routed = await router.route(simpleTask(), "normal");
    expect(routed.selected?.provider).not.toBe("ollama");
    expect(routed.selected?.computeTier).toMatch(/^(STRONG|OTHER)_FREE_CLOUD$/);
    expect(routed.selected?.monetaryCostUsd).toBe(0);
    const complex = await router.route(complexTask(), "normal");
    expect(complex.candidates.some((candidate) => candidate.provider === "ollama")).toBe(false);
    expect(complex.rejectedCandidates?.some((candidate) => candidate.provider === "ollama" && candidate.reasons.some((reason) => reason.startsWith("quality-floor")))).toBe(true);
  });
  it("keeps an acceptable local model behind all acceptable free-cloud candidates", async () => {
    const selector = new AdaptiveModelSelector(await providerStatePath(), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
      ollamaBaseUrl: await ollamaServer(),
      quotaSource: new JourneyQuotaSource(),
      capabilitySource: new JourneyCapabilitySource(0.76)
    });
    const route = await selector.route(simpleTask(), "normal");
    expect(route.capacityStatus).toBe("NORMAL");
    expect(route.selected?.local).toBe(false);
    expect(["STRONG_FREE_CLOUD", "OTHER_FREE_CLOUD"]).toContain(route.selected?.computeTier);
    const firstLocal = route.candidates.findIndex((candidate) => candidate.local);
    const lastCloud = route.candidates.map((candidate) => candidate.local).lastIndexOf(false);
    expect(firstLocal).toBeGreaterThan(lastCloud);
    expect(route.candidates.filter((candidate) => candidate.local).every((candidate) => candidate.computeTier === "LOCAL_EMERGENCY")).toBe(true);
  });

  it("rejects local emergency compute below a complex mission floor", async () => {
    const selector = new AdaptiveModelSelector(await providerStatePath(), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
      ollamaBaseUrl: await ollamaServer(),
      quotaSource: new JourneyQuotaSource(),
      capabilitySource: new JourneyCapabilitySource(0.42)
    });
    const route = await selector.route(complexTask(), "normal");
    expect(route.candidates.some((candidate) => candidate.provider === "ollama")).toBe(false);
    const rejectedLocal = route.rejectedCandidates?.filter((candidate) => candidate.provider === "ollama") ?? [];
    expect(rejectedLocal.length).toBeGreaterThan(0);
    expect(rejectedLocal.every((candidate) => candidate.computeTier === "LOCAL_EMERGENCY" && candidate.reasons.some((reason) => reason.startsWith("quality-floor:")))).toBe(true);
  });

  it("uses qualified local compute as an airbag when cloud is operationally unavailable", async () => {
    const selector = new AdaptiveModelSelector(await providerStatePath(), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
      ollamaBaseUrl: await ollamaServer(),
      quotaSource: new JourneyQuotaSource(),
      capabilitySource: new JourneyCapabilitySource(0.76),
      canAttempt: async (candidate) => candidate.provider === "ollama"
    });
    const route = await selector.route(simpleTask(), "normal");
    expect(route.capacityStatus).toBe("CAPACITY_REDUCED");
    expect(route.selected?.provider).toBe("ollama");
    expect(route.selected?.computeTier).toBe("LOCAL_EMERGENCY");
  });

  it("returns NEEDS_CAPABILITY when cloud is unavailable and local is below the floor", async () => {
    const selector = new AdaptiveModelSelector(await providerStatePath(), { economicEvidence: async (provider, model) => fixtureZeroCost(provider, model),
      ollamaBaseUrl: await ollamaServer(),
      quotaSource: new JourneyQuotaSource(),
      capabilitySource: new JourneyCapabilitySource(0.4),
      canAttempt: async (candidate) => candidate.provider === "ollama"
    });
    const route = await selector.route(complexTask(), "normal");
    expect(route.candidates).toHaveLength(0);
    expect(route.selected).toBeUndefined();
    expect(route.capacityStatus).toBe("NEEDS_CAPABILITY");
    expect(route.reason).toContain("below the mission quality floor");
  });
});
