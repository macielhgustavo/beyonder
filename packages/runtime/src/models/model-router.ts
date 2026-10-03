import type { AppConfig } from "../config/env.js";
import type { ModelMessage, ModelResponse } from "../types.js";
import { AutopilotStateStore, buildComputeInventory } from "@beyonder/compute";

export class ModelRouter {
  constructor(private readonly config: AppConfig["model"]) {}

  async complete(messages: ModelMessage[]): Promise<ModelResponse> {
    if (this.config.provider === "auto") {
      const selected = await this.selectFreeProvider();
      if (!selected) {
        return {
          content: "No free READY/keyless provider is available. Continue with deterministic local policy.",
          provider: "none",
          model: "none",
          estimatedCostUsd: 0
        };
      }

      return {
        content: `Selected zero-cost provider ${selected.providerId} with model ${selected.model}.`,
        provider: selected.providerId,
        model: selected.model,
        estimatedCostUsd: 0,
        raw: selected
      };
    }

    if (this.config.provider === "none") {
      return {
        content: "No paid or remote model configured. Continue with deterministic local policy.",
        provider: "none",
        model: "none",
        estimatedCostUsd: 0
      };
    }

    if (this.config.provider === "ollama") {
      return this.completeWithOllama(messages);
    }

    return this.completeWithOpenAiCompatible(messages);
  }

  private async selectFreeProvider(): Promise<{ providerId: string; model: string; status: string } | null> {
    const state = await new AutopilotStateStore(this.config.providerStatePath).read();
    const inventory = buildComputeInventory(state)
      .filter((entry) => entry.cost === "$0")
      .filter((entry) => ["healthy", "keyless"].includes(entry.status))
      .sort((a, b) => qualityRank(b.qualityClass) - qualityRank(a.qualityClass));
    const selected = inventory[0];
    if (!selected) return null;
    return {
      providerId: selected.providerId,
      model: selected.models[0] ?? this.config.name,
      status: selected.status
    };
  }

  private async completeWithOllama(messages: ModelMessage[]): Promise<ModelResponse> {
    const response = await fetch(`${this.config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.config.name,
        messages,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as { message?: { content?: string } };
    return {
      content: json.message?.content ?? "",
      provider: "ollama",
      model: this.config.name,
      estimatedCostUsd: 0,
      raw: json
    };
  }

  private async completeWithOpenAiCompatible(messages: ModelMessage[]): Promise<ModelResponse> {
    if (!this.config.openAiCompatBaseUrl || !this.config.openAiCompatApiKey) {
      throw new Error("OpenAI-compatible provider requires base URL and API key.");
    }

    const response = await fetch(`${this.config.openAiCompatBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.openAiCompatApiKey}`
      },
      body: JSON.stringify({
        model: this.config.name,
        messages
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible request failed: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return {
      content: json.choices?.[0]?.message?.content ?? "",
      provider: "openai-compatible",
      model: this.config.name,
      estimatedCostUsd: 0,
      raw: json
    };
  }
}

function qualityRank(quality: "high" | "medium" | "low" | "unknown"): number {
  if (quality === "high") return 3;
  if (quality === "medium") return 2;
  if (quality === "low") return 1;
  return 0;
}
