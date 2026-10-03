import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = z.preprocess(
  (value) => {
    if (typeof value === "boolean") return value;
    if (value == null || value === "") return false;
    return value === "true" || value === "1";
  },
  z.boolean()
);

const numberFromEnv = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value == null || value === "" ? fallback : Number(value)))
    .pipe(z.number().finite().nonnegative());

const envSchema = z.object({
  BEYONDER_DB_PATH: z.string().default("./data/beyonder.sqlite"),
  BEYONDER_AGENT_NAME: z.string().default("beyonder"),
  BEYONDER_INITIAL_CAPITAL_USD: numberFromEnv(0),
  BEYONDER_SIMULATED_CAPITAL_USD: numberFromEnv(0),
  BEYONDER_USE_SIMULATED_CAPITAL: booleanFromEnv,
  BEYONDER_MONTHLY_FIXED_COST_USD: numberFromEnv(0),
  BEYONDER_LOOP_INTERVAL_MS: numberFromEnv(1000),
  BEYONDER_MAX_STEPS: numberFromEnv(1),
  BEYONDER_TOOLS_ENABLED: booleanFromEnv,
  BEYONDER_SHELL_ENABLED: booleanFromEnv,
  BEYONDER_BROWSER_ENABLED: booleanFromEnv,
  BEYONDER_FILESYSTEM_ENABLED: booleanFromEnv,
  BEYONDER_MODEL_PROVIDER: z.enum(["auto", "none", "ollama", "openai-compatible"]).default("auto"),
  BEYONDER_MODEL_NAME: z.string().default("llama3.2"),
  BEYONDER_PROVIDER_STATE_PATH: z.string().default(".providers-vault/autopilot-state.json"),
  BEYONDER_BENCHMARK_DB_PATH: z.string().default("./data/beyonder-benchmark.sqlite"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OPENAI_COMPAT_BASE_URL: z.string().optional().default(""),
  OPENAI_COMPAT_API_KEY: z.string().optional().default("")
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(overrides: Partial<Record<string, string>> = {}) {
  const parsed = envSchema.parse({ ...process.env, ...overrides });
  const startingCapitalUsd = parsed.BEYONDER_USE_SIMULATED_CAPITAL
    ? parsed.BEYONDER_SIMULATED_CAPITAL_USD
    : parsed.BEYONDER_INITIAL_CAPITAL_USD;

  return {
    dbPath: parsed.BEYONDER_DB_PATH,
    agentName: parsed.BEYONDER_AGENT_NAME,
    startingCapitalUsd,
    monthlyFixedCostUsd: parsed.BEYONDER_MONTHLY_FIXED_COST_USD,
    loopIntervalMs: parsed.BEYONDER_LOOP_INTERVAL_MS,
    maxSteps: parsed.BEYONDER_MAX_STEPS,
    tools: {
      enabled: parsed.BEYONDER_TOOLS_ENABLED,
      shell: parsed.BEYONDER_TOOLS_ENABLED && parsed.BEYONDER_SHELL_ENABLED,
      browser: parsed.BEYONDER_TOOLS_ENABLED && parsed.BEYONDER_BROWSER_ENABLED,
      filesystem: parsed.BEYONDER_TOOLS_ENABLED && parsed.BEYONDER_FILESYSTEM_ENABLED
    },
    model: {
      provider: parsed.BEYONDER_MODEL_PROVIDER,
      name: parsed.BEYONDER_MODEL_NAME,
      providerStatePath: parsed.BEYONDER_PROVIDER_STATE_PATH,
      benchmarkDbPath: parsed.BEYONDER_BENCHMARK_DB_PATH,
      ollamaBaseUrl: parsed.OLLAMA_BASE_URL,
      openAiCompatBaseUrl: parsed.OPENAI_COMPAT_BASE_URL,
      openAiCompatApiKey: parsed.OPENAI_COMPAT_API_KEY
    }
  };
}
