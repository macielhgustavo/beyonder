import type { AppConfig } from "../config/env.js";
import type { ModelMessage, ModelResponse } from "../types.js";

export class ModelRouter {
  constructor(private readonly config: AppConfig["model"]) {}

  async complete(messages: ModelMessage[]): Promise<ModelResponse> {
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
