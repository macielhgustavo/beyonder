import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { CredentialDescriptor } from '@beyonder/credentials';
import type { ModelCatalogEntry, ProviderCatalogEntry } from './types.js';

export type EconomicTruth = boolean | 'UNKNOWN';
export type CostDecisionClass = 'ZERO_COST_CONFIRMED' | 'FREE_QUOTA_CONFIRMED' | 'UNKNOWN_COST' | 'PAID' | 'BILLING_RISK' | 'FREE_QUOTA_EXHAUSTED' | 'BILLING_STATE_UNKNOWN' | 'DEV_EVAL_ONLY';
export type ProviderAccountPlan = 'GEMINI_FREE' | 'GROQ_FREE' | 'CLOUDFLARE_WORKERS_FREE' | 'NVIDIA_DEVELOPER';
const PLAN_FINGERPRINT_ENV: Partial<Record<string, [ProviderAccountPlan, string]>> = {
  gemini: ['GEMINI_FREE', 'BEYONDER_GEMINI_FREE_TIER_CREDENTIAL_SHA256'],
  groq: ['GROQ_FREE', 'BEYONDER_GROQ_FREE_PLAN_CREDENTIAL_SHA256'],
  'cloudflare-workers-ai': ['CLOUDFLARE_WORKERS_FREE', 'BEYONDER_CLOUDFLARE_WORKERS_FREE_CREDENTIAL_SHA256'],
  'nvidia-nim': ['NVIDIA_DEVELOPER', 'BEYONDER_NVIDIA_DEVELOPER_CREDENTIAL_SHA256']
};
/** Hash binds a stable operator plan declaration to the current key and, for Cloudflare, account ID. Never persist the key. */
export function providerCredentialFingerprint(provider: string, apiKey: string, accountId = ''): string {
  return createHash('sha256').update('beyonder-provider-plan-v1\0').update(provider).update('\0').update(accountId).update('\0').update(apiKey).digest('hex');
}
export function declaredProviderAccountPlan(provider: string, apiKey?: string, accountId = '', env: NodeJS.ProcessEnv = process.env): ProviderAccountPlan | undefined {
  const declaration = PLAN_FINGERPRINT_ENV[provider];
  if (!declaration || !apiKey) return undefined;
  const expected = env[declaration[1]];
  return expected && /^[a-f0-9]{64}$/.test(expected) && expected === providerCredentialFingerprint(provider, apiKey, accountId) ? declaration[0] : undefined;
}
const GEMINI_FREE_TEXT_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']);
const GROQ_FREE_TEXT_MODELS = new Set(['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']);
const CLOUDFLARE_PAID_ONLY_MODELS = new Set(['@cf/moonshotai/kimi-k2.6', '@cf/moonshotai/kimi-k2.7-code', '@cf/zai-org/glm-5.2', '@cf/zai-org/glm-5.3', '@cf/zai-org/glm-5.3-flash', '@cf/deepseek-ai/deepseek-v4-flash-0731', '@cf/deepseek-ai/deepseek-v4-pro-0813']);
const CLOUDFLARE_FREE_TEXT_MODELS = new Set(['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct', '@cf/mistral/mistral-7b-instruct-v0.1', '@cf/zai-org/glm-4.7-flash', '@cf/google/gemma-4-26b-a4b-it', '@cf/nvidia/nemotron-3-120b-a12b']);
export type FreeQuotaState = 'AVAILABLE' | 'EXHAUSTED' | 'UNKNOWN';
/** Account-specific evidence is supplied by an authorized operator/backend, not inferred from auth/catalog discovery. */
export interface AccountCostEvidence {
  version: 1; provider: string; model: string; endpoint: string;
  source: 'provider-account-api' | 'operator-verified-account';
  checkedAt: string; expiresAt: string;
  credentialSource: CredentialDescriptor['source']; credentialLastValidated: string;
  accountBillingState: 'DISABLED' | 'ENABLED' | 'UNKNOWN';
  freeTierEligible: EconomicTruth; freeQuota: FreeQuotaState;
  spendCap: 'ENFORCED_ZERO' | 'NONE' | 'UNKNOWN';
  providerBillingBehavior: 'REJECT_AFTER_FREE_QUOTA' | 'MAY_CHARGE' | 'UNKNOWN';
  billingSpilloverPossible: EconomicTruth;
}
export interface ZeroCostDecision {
  version: 1; provider: string; model: string;
  costClass: NonNullable<ModelCatalogEntry['costClass']>;
  classification: CostDecisionClass; source: 'NONE' | 'LOCAL_ENDPOINT' | 'EXPLICIT_FREE_ROUTE_AND_LIVE_PRICE' | 'OFFICIAL_FREE_ROUTER' | 'PROVIDER_FREE_PLAN' | AccountCostEvidence['source'];
  checkedAt: string; expiresAt: string;
  accountBillingState: AccountCostEvidence['accountBillingState'];
  freeTierEligible: EconomicTruth; freeQuota: FreeQuotaState;
  spendCap: AccountCostEvidence['spendCap'];
  providerBillingBehavior: AccountCostEvidence['providerBillingBehavior'];
  billingSpilloverPossible: EconomicTruth;
  zeroCostExecutionGuaranteed: boolean;
  monetaryCost: { state: 'CONFIRMED_ZERO'; usd: 0 } | { state: 'UNKNOWN' };
  reason: string;
}
export interface EconomicQuota {
  requestQuotaRemaining: number | 'unknown'; tokenQuotaRemaining: number | 'unknown';
  lastUpdatedAt: string; resetAt: string;
}

/** A rate-limit observation can veto execution; it is not account billing proof. */
export function observedEconomicQuota(progress?: { lastUpdatedAt: string; validation?: { rateLimitHeaders?: Record<string, string> } }): EconomicQuota {
  const headers = Object.fromEntries(Object.entries(progress?.validation?.rateLimitHeaders ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const remaining = (names: string[]): number | 'unknown' => {
    for (const name of names) {
      const raw = headers[name];
      if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw)) && Number(raw) >= 0) return Number(raw);
    }
    return 'unknown';
  };
  return { requestQuotaRemaining: remaining(['x-ratelimit-remaining-requests', 'ratelimit-remaining', 'x-rate-limit-remaining']), tokenQuotaRemaining: remaining(['x-ratelimit-remaining-tokens']), lastUpdatedAt: progress?.lastUpdatedAt ?? 'unknown', resetAt: 'unknown' };
}

export function isLocalZeroCostEndpoint(endpoint: string): boolean {
  try { const url = new URL(endpoint); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); }
  catch { return false; }
}

/** No monetary value is assigned until an execution has passed this hard constraint. */
export function resolveZeroCostExecution(input: {
  provider: ProviderCatalogEntry | { id: 'ollama'; openAiCompatibleEndpoint?: string; billingRisk?: boolean };
  model: ModelCatalogEntry; accountEvidence?: AccountCostEvidence; credential?: CredentialDescriptor;
  quota?: EconomicQuota; now?: number; accountPlan?: ProviderAccountPlan; usageContext?: 'PRODUCT' | 'DEV_EVAL';
}): ZeroCostDecision {
  const now = input.now ?? Date.now(), provider = input.provider, model = input.model;
  const decision: ZeroCostDecision = { version: 1, provider: provider.id, model: model.id, costClass: model.costClass ?? 'UNKNOWN_COST', classification: 'UNKNOWN_COST', source: 'NONE', checkedAt: new Date(now).toISOString(), expiresAt: new Date(now).toISOString(), accountBillingState: 'UNKNOWN', freeTierEligible: ['FREE_CONFIRMED', 'FREE_TIER_ELIGIBLE'].includes(model.costClass ?? '') ? true : 'UNKNOWN', freeQuota: 'UNKNOWN', spendCap: 'UNKNOWN', providerBillingBehavior: 'UNKNOWN', billingSpilloverPossible: 'UNKNOWN', zeroCostExecutionGuaranteed: false, monetaryCost: { state: 'UNKNOWN' }, reason: 'No execution-specific zero-cost evidence.' };
  const reject = (classification: CostDecisionClass, reason: string) => Object.assign(decision, { classification, reason });
  const confirm = (classification: 'ZERO_COST_CONFIRMED' | 'FREE_QUOTA_CONFIRMED', reason: string, expiresAt: string): ZeroCostDecision => ({ ...decision, classification, reason, expiresAt, zeroCostExecutionGuaranteed: true, monetaryCost: { state: 'CONFIRMED_ZERO', usd: 0 } });
  if (provider.id === 'nvidia-nim' && input.usageContext !== 'DEV_EVAL') return reject('DEV_EVAL_ONLY', 'NVIDIA Developer access is limited to development and evaluation; production objectives are excluded.');
  if (provider.billingRisk || model.billingRisk) return reject('BILLING_RISK', 'Provider/model has billing risk.');
  if (model.status === 'PAID_ONLY' || model.status === 'BILLING_REQUIRED' || 'classification' in provider && provider.classification === 'PAID_ONLY' || provider.id === 'cloudflare-workers-ai' && CLOUDFLARE_PAID_ONLY_MODELS.has(model.id)) return reject('PAID', 'Paid compute is disabled.');
  // Workers Free and Groq Free include models with published paid-plan unit prices.
  // The account contract, not that nominal price, controls billing on Free.
  if (model.costClass === 'PAID' && !['groq', 'cloudflare-workers-ai'].includes(provider.id)) return reject('PAID', 'Paid compute is disabled.');
  const quota = input.quota;
  const freshQuota = quota && fresh(quota.lastUpdatedAt, now, 300_000) && (quota.resetAt === 'unknown' || Date.parse(quota.resetAt) > now);
  if (freshQuota && (quota.requestQuotaRemaining === 0 || quota.tokenQuotaRemaining === 0)) { decision.freeQuota = 'EXHAUSTED'; return reject('FREE_QUOTA_EXHAUSTED', 'Observed quota exhausted; reset does not prove replenishment.'); }
  if (provider.id === 'ollama') {
    if (!isLocalZeroCostEndpoint(provider.openAiCompatibleEndpoint ?? '') || /(?:[:/-]cloud)$/i.test(model.id)) return reject('BILLING_RISK', 'Only a local endpoint and local model can supply local zero-cost evidence.');
    Object.assign(decision, { source: 'LOCAL_ENDPOINT', accountBillingState: 'DISABLED', billingSpilloverPossible: false, spendCap: 'ENFORCED_ZERO', providerBillingBehavior: 'REJECT_AFTER_FREE_QUOTA' });
    return confirm('ZERO_COST_CONFIRMED', 'Local inference endpoint; no provider monetary billing. Local resource/shadow cost remains separate.', new Date(now + 60_000).toISOString());
  }

  if (['gemini', 'groq', 'cloudflare-workers-ai', 'nvidia-nim'].includes(provider.id)) {
    const required: Partial<Record<string, ProviderAccountPlan>> = { gemini: 'GEMINI_FREE', groq: 'GROQ_FREE', 'cloudflare-workers-ai': 'CLOUDFLARE_WORKERS_FREE', 'nvidia-nim': 'NVIDIA_DEVELOPER' };
    if (input.accountPlan !== required[provider.id]) return reject('BILLING_STATE_UNKNOWN', 'Current credential has no matching provider-specific free plan declaration.');
    const eligible = provider.id === 'gemini' ? GEMINI_FREE_TEXT_MODELS.has(model.id)
      : provider.id === 'groq' ? GROQ_FREE_TEXT_MODELS.has(model.id)
      : provider.id === 'nvidia-nim' ? input.usageContext === 'DEV_EVAL' && model.costClass !== 'PAID'
      : CLOUDFLARE_FREE_TEXT_MODELS.has(model.id) && model.capabilities.some(cap => ['CHAT', 'REASONING', 'CODING'].includes(cap));
    if (!eligible) return reject('UNKNOWN_COST', 'Model is not confirmed for this provider free-plan text policy.');
    Object.assign(decision, { source: 'PROVIDER_FREE_PLAN', accountBillingState: 'DISABLED', freeTierEligible: true, billingSpilloverPossible: false, spendCap: 'ENFORCED_ZERO', providerBillingBehavior: 'REJECT_AFTER_FREE_QUOTA' });
    return confirm('FREE_QUOTA_CONFIRMED', 'Credential-bound provider free plan; unknown remaining quota may cause a rate-limit response but cannot spill into paid usage.', new Date(now + 60_000).toISOString());
  }

  // OpenRouter publishes openrouter/free as its dedicated free-model router. The
  // runtime also sends a zero price ceiling and checks the returned usage cost,
  // so this official route does not need per-model catalog pricing to execute.
  const officialOpenRouterFreeRouter = provider.id === 'openrouter'
    && provider.openAiCompatibleEndpoint === 'https://openrouter.ai/api/v1'
    && model.id === 'openrouter/free'
    && ['FREE_CONFIRMED', 'FREE_TIER_ELIGIBLE'].includes(model.costClass ?? '');
  if (officialOpenRouterFreeRouter) {
    Object.assign(decision, { source: 'OFFICIAL_FREE_ROUTER', billingSpilloverPossible: false, spendCap: 'ENFORCED_ZERO', providerBillingBehavior: 'REJECT_AFTER_FREE_QUOTA' });
    return confirm('ZERO_COST_CONFIRMED', 'Official OpenRouter free-model router; request price ceiling and response cost check keep paid spillover disabled.', new Date(now + 60_000).toISOString());
  }

  const price = model.costEvidence;
  const gatewayEndpoints: Record<string, string> = { openrouter: 'https://openrouter.ai/api/v1', 'kilo-gateway': 'https://api.kilo.ai/api/gateway' };
  const explicitFreeRoute = provider.id === 'openrouter'
    ? model.id.endsWith(':free')
    : provider.id === 'kilo-gateway' && /(?::|-)free$/i.test(model.id) && price?.explicitFreeRoute === true;
  if (gatewayEndpoints[provider.id] === provider.openAiCompatibleEndpoint && explicitFreeRoute && price?.zeroPrice === true && price.source === 'live-catalog' && fresh(price.observedAt, now, 86_400_000) && ['FREE_CONFIRMED', 'FREE_TIER_ELIGIBLE'].includes(model.costClass ?? '')) {
    Object.assign(decision, { source: 'EXPLICIT_FREE_ROUTE_AND_LIVE_PRICE', billingSpilloverPossible: false, spendCap: 'ENFORCED_ZERO', providerBillingBehavior: 'REJECT_AFTER_FREE_QUOTA' });
    return confirm('ZERO_COST_CONFIRMED', 'Zero-priced free gateway route confirmed by the live catalog; paid substitution remains disallowed by the request price ceiling and response cost check.', new Date(Math.min(now + 60_000, Date.parse(price.observedAt) + 86_400_000)).toISOString());
  }
  const evidence = input.accountEvidence;
  if (!evidence || !validAccountEvidence(evidence, now) || evidence.provider !== provider.id || evidence.model !== model.id || evidence.endpoint !== provider.openAiCompatibleEndpoint) return reject(model.costClass === 'UNKNOWN_COST' || !model.costClass ? 'UNKNOWN_COST' : 'BILLING_STATE_UNKNOWN', 'Free-tier eligibility does not prove account billing, free quota or spillover protection.');
  const credential = input.credential;
  if (!credential?.accessible || credential.valid !== true || credential.source !== evidence.credentialSource || credential.lastValidated !== evidence.credentialLastValidated) return reject('BILLING_STATE_UNKNOWN', 'Account proof is not bound to the currently validated credential source/revision.');
  Object.assign(decision, { source: evidence.source, accountBillingState: evidence.accountBillingState, freeTierEligible: evidence.freeTierEligible, freeQuota: evidence.freeQuota, spendCap: evidence.spendCap, providerBillingBehavior: evidence.providerBillingBehavior, billingSpilloverPossible: evidence.billingSpilloverPossible });
  if (evidence.freeQuota === 'EXHAUSTED') return reject('FREE_QUOTA_EXHAUSTED', 'Account-specific free quota is exhausted.');
  if (evidence.billingSpilloverPossible === true || evidence.providerBillingBehavior === 'MAY_CHARGE' && evidence.spendCap !== 'ENFORCED_ZERO') return reject('BILLING_RISK', 'This account can charge after free quota.');
  const protectedAccount = evidence.spendCap === 'ENFORCED_ZERO' || evidence.accountBillingState === 'DISABLED' && evidence.providerBillingBehavior === 'REJECT_AFTER_FREE_QUOTA' && evidence.billingSpilloverPossible === false;
  if (!protectedAccount) return reject('BILLING_STATE_UNKNOWN', 'No effective zero spend cap or verified reject-after-free billing protection.');
  if (evidence.freeTierEligible !== true) return reject('UNKNOWN_COST', 'Account is not confirmed eligible for the free tier.');
  // Unknown quota means a possible 429, not a charge, when the current account
  // is proven unable to spill into paid usage. Exhaustion remains a hard block.
  return confirm('FREE_QUOTA_CONFIRMED', evidence.freeQuota === 'AVAILABLE'
    ? 'Current account-bound free quota and enforced zero-charge protection.'
    : 'Free-tier account has enforced zero-charge protection; remaining quota is unknown.', evidence.expiresAt);
}

function fresh(timestamp: string, now: number, ttl: number) { const age = now - Date.parse(timestamp); return Number.isFinite(age) && age >= 0 && age < ttl; }
export function validAccountEvidence(value: AccountCostEvidence, now = Date.now()): boolean {
  return value.version === 1 && ['provider-account-api', 'operator-verified-account'].includes(value.source) && fresh(value.checkedAt, now, 300_000) && Date.parse(value.expiresAt) > now && Date.parse(value.expiresAt) <= Date.parse(value.checkedAt) + 300_000;
}
/** Only a specifically configured authorized evidence file is read; no secret discovery. Unknown/malformed evidence fails closed. */
export async function readAccountCostEvidence(path = process.env.BEYONDER_ZERO_COST_EVIDENCE_PATH): Promise<AccountCostEvidence[]> {
  if (!path) return [];
  try {
    const raw = await readFile(path, 'utf8'); if (raw.length > 262_144) return [];
    const file = JSON.parse(raw) as { version?: unknown; accounts?: unknown };
    if (file.version !== 1 || !Array.isArray(file.accounts)) return [];
    return file.accounts.filter(isAccountEvidence).map(row => ({ version: 1, provider: row.provider, model: row.model, endpoint: row.endpoint, source: row.source, checkedAt: row.checkedAt, expiresAt: row.expiresAt, credentialSource: row.credentialSource, credentialLastValidated: row.credentialLastValidated, accountBillingState: row.accountBillingState, freeTierEligible: row.freeTierEligible, freeQuota: row.freeQuota, spendCap: row.spendCap, providerBillingBehavior: row.providerBillingBehavior, billingSpilloverPossible: row.billingSpilloverPossible }));
  } catch { return []; }
}
function isAccountEvidence(row: unknown): row is AccountCostEvidence {
  if (!row || typeof row !== 'object') return false;
  const v = row as Record<string, unknown>;
  return v.version === 1 && ['provider', 'model', 'endpoint', 'checkedAt', 'expiresAt', 'credentialLastValidated'].every(k => typeof v[k] === 'string' && (v[k] as string).length < 1024)
    && ['provider-account-api', 'operator-verified-account'].includes(String(v.source))
    && ['SESSION', 'BEYONDER_VAULT', 'ENVIRONMENT_BACKEND', 'OS_KEYRING', 'ENV_COMPATIBILITY'].includes(String(v.credentialSource))
    && ['DISABLED', 'ENABLED', 'UNKNOWN'].includes(String(v.accountBillingState)) && [true, false, 'UNKNOWN'].includes(v.freeTierEligible as EconomicTruth)
    && ['AVAILABLE', 'EXHAUSTED', 'UNKNOWN'].includes(String(v.freeQuota)) && ['ENFORCED_ZERO', 'NONE', 'UNKNOWN'].includes(String(v.spendCap))
    && ['REJECT_AFTER_FREE_QUOTA', 'MAY_CHARGE', 'UNKNOWN'].includes(String(v.providerBillingBehavior)) && [true, false, 'UNKNOWN'].includes(v.billingSpilloverPossible as EconomicTruth);
}
export function requireZeroCostDecision(decision: ZeroCostDecision | undefined, provider: string, model: string, now = Date.now()): asserts decision is ZeroCostDecision {
  if (!decision?.zeroCostExecutionGuaranteed || !['ZERO_COST_CONFIRMED', 'FREE_QUOTA_CONFIRMED'].includes(decision.classification) || decision.source === 'NONE' || decision.costClass === 'PAID' && decision.source !== 'PROVIDER_FREE_PLAN' || decision.billingSpilloverPossible === true || decision.monetaryCost.state !== 'CONFIRMED_ZERO' || decision.monetaryCost.usd !== 0 || decision.provider !== provider || decision.model !== model || !fresh(decision.checkedAt, now, 300_000) || !(Date.parse(decision.expiresAt) > now)) throw new Error('ZERO_COST_EXECUTION_NOT_GUARANTEED');
}
