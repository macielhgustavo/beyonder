import type { ModelCapability, ModelCatalogEntry, ProviderCatalogEntry } from "./types.js";

export type ModelWorkload = "general_chat" | "coding" | "embedding" | "benchmark_text";

const INCOMPATIBLE_CHAT_CAPABILITIES = new Set<ModelCapability>(["EMBEDDING", "RERANK", "VISION", "AUDIO"]);

export function modelMetadata(provider: ProviderCatalogEntry, modelId: string): ModelCatalogEntry {
  const explicit = provider.modelCatalog?.find((model) => model.id === modelId);
  if (explicit) return explicit;
  return {
    id: modelId,
    capabilities: inferCapabilities(modelId),
    status: "UNKNOWN"
  };
}

export function modelsWithMetadata(provider: ProviderCatalogEntry, models: readonly string[]): ModelCatalogEntry[] {
  return models.map((model) => modelMetadata(provider, model));
}

export function isModelEligibleForWorkload(
  provider: ProviderCatalogEntry,
  modelId: string,
  workload: ModelWorkload
): boolean {
  const metadata = modelMetadata(provider, modelId);
  if (metadata.billingRisk || metadata.status === "PAID_ONLY" || metadata.status === "BILLING_REQUIRED") return false;
  if (metadata.status === "MODEL_UNAVAILABLE" || metadata.status === "UNSUPPORTED") return false;

  switch (workload) {
    case "embedding":
      return metadata.capabilities.includes("EMBEDDING");
    case "coding":
      return hasTextChatCapability(metadata) && !hasIncompatibleChatOnlyCapability(metadata);
    case "general_chat":
    case "benchmark_text":
      return hasTextChatCapability(metadata) && !hasIncompatibleChatOnlyCapability(metadata);
  }
}

export function eligibleModelsForWorkload(
  provider: ProviderCatalogEntry,
  models: readonly string[],
  workload: ModelWorkload
): string[] {
  return models.filter((model) => isModelEligibleForWorkload(provider, model, workload));
}

function hasTextChatCapability(metadata: ModelCatalogEntry): boolean {
  return metadata.capabilities.some((capability) => capability === "CHAT" || capability === "REASONING" || capability === "CODING");
}

function hasIncompatibleChatOnlyCapability(metadata: ModelCatalogEntry): boolean {
  return metadata.capabilities.some((capability) => INCOMPATIBLE_CHAT_CAPABILITIES.has(capability)) && !hasTextChatCapability(metadata);
}

function inferCapabilities(modelId: string): ModelCapability[] {
  const normalized = modelId.toLowerCase();
  if (/\b(embed|embedding|bge-|e5-|gte-|text-embedding)\b|\/bge|qwen3-embedding/.test(normalized)) return ["EMBEDDING"];
  if (/rerank|reranker/.test(normalized)) return ["RERANK"];
  if (/whisper|speech|audio|tts|transcribe/.test(normalized)) return ["AUDIO"];
  if (/stable-diffusion|image|sdxl|flux|dall-e|vision|vl\b/.test(normalized)) return ["VISION"];
  if (/coder|code|codestral|starcoder/.test(normalized)) return ["CHAT", "CODING"];
  if (/reason|r1|thinking|nemotron|qwen|llama|mistral|gemma|gemini|glm|deepseek|gpt|command|claude|jamba|aya|kimi|ling|solar|instruct|chat/.test(normalized)) {
    return ["CHAT", "REASONING"];
  }
  return ["OTHER"];
}
