import test from 'node:test';
import assert from 'node:assert/strict';
import { getProvider } from './catalog.js';
import { declaredProviderAccountPlan, providerCredentialFingerprint, requireZeroCostDecision, resolveZeroCostExecution, type ProviderAccountPlan } from './economics.js';
import type { ModelCatalogEntry } from './types.js';

function policy(providerId: string, model: ModelCatalogEntry, accountPlan?: ProviderAccountPlan, extra: { usageContext?: 'DEV_EVAL'; quota?: Parameters<typeof resolveZeroCostExecution>[0]['quota'] } = {}) {
  return resolveZeroCostExecution({ provider: getProvider(providerId)!, model, accountPlan, ...extra });
}
const chat = (id: string, costClass: ModelCatalogEntry['costClass'] = 'UNKNOWN_COST'): ModelCatalogEntry => ({ id, costClass, capabilities: ['CHAT'] });

test('plan declaration is stable and bound to current provider credential and Cloudflare account', () => {
  const key = 'test-key';
  const hash = providerCredentialFingerprint('gemini', key);
  assert.equal(declaredProviderAccountPlan('gemini', key, '', { BEYONDER_GEMINI_FREE_TIER_CREDENTIAL_SHA256: hash }), 'GEMINI_FREE');
  assert.equal(declaredProviderAccountPlan('gemini', 'rotated', '', { BEYONDER_GEMINI_FREE_TIER_CREDENTIAL_SHA256: hash }), undefined);
  assert.equal(declaredProviderAccountPlan('groq', key, '', { BEYONDER_GEMINI_FREE_TIER_CREDENTIAL_SHA256: hash }), undefined);
  const cfHash = providerCredentialFingerprint('cloudflare-workers-ai', key, 'account-a');
  assert.equal(declaredProviderAccountPlan('cloudflare-workers-ai', key, 'account-b', { BEYONDER_CLOUDFLARE_WORKERS_FREE_CREDENTIAL_SHA256: cfHash }), undefined);
  assert.equal(declaredProviderAccountPlan('cloudflare-workers-ai', key, 'account-a', { BEYONDER_CLOUDFLARE_WORKERS_FREE_CREDENTIAL_SHA256: cfHash }), 'CLOUDFLARE_WORKERS_FREE');
});

test('Gemini Free Tier admits a listed model with unknown quota but blocks paid or unknown account mode', () => {
  const model = chat('gemini-2.5-flash');
  const free = policy('gemini', model, 'GEMINI_FREE');
  assert.equal(free.source, 'PROVIDER_FREE_PLAN');
  assert.equal(free.freeQuota, 'UNKNOWN');
  requireZeroCostDecision(free, 'gemini', model.id);
  assert.equal(policy('gemini', model).classification, 'BILLING_STATE_UNKNOWN');
  assert.equal(policy('gemini', model, 'GROQ_FREE').classification, 'BILLING_STATE_UNKNOWN');
  assert.equal(policy('gemini', chat('gemini-paid-only', 'PAID'), 'GEMINI_FREE').classification, 'PAID');
});

test('Groq Free Plan admits covered text models despite nominal price and rejects paid or unknown plan', () => {
  const model = chat('openai/gpt-oss-120b', 'PAID');
  const free = policy('groq', model, 'GROQ_FREE');
  assert.equal(free.zeroCostExecutionGuaranteed, true);
  requireZeroCostDecision(free, 'groq', model.id);
  assert.equal(policy('groq', model).classification, 'BILLING_STATE_UNKNOWN');
  assert.equal(policy('groq', chat('unknown-groq-model'), 'GROQ_FREE').classification, 'UNKNOWN_COST');
});

test('Cloudflare Workers Free admits known free text models and rejects paid-only model or Paid account', () => {
  const freeModel = chat('@cf/zai-org/glm-4.7-flash', 'PAID');
  const free = policy('cloudflare-workers-ai', freeModel, 'CLOUDFLARE_WORKERS_FREE');
  requireZeroCostDecision(free, 'cloudflare-workers-ai', freeModel.id);
  assert.equal(policy('cloudflare-workers-ai', freeModel).classification, 'BILLING_STATE_UNKNOWN');
  assert.equal(policy('cloudflare-workers-ai', chat('@cf/moonshotai/kimi-k2.6'), 'CLOUDFLARE_WORKERS_FREE').classification, 'PAID');
  assert.equal(policy('cloudflare-workers-ai', chat('@cf/unknown/new-model'), 'CLOUDFLARE_WORKERS_FREE').classification, 'UNKNOWN_COST');
});

test('fresh observed quota zero blocks a free account but unknown quota does not', () => {
  const model = chat('openai/gpt-oss-20b');
  assert.equal(policy('groq', model, 'GROQ_FREE').zeroCostExecutionGuaranteed, true);
  const exhausted = policy('groq', model, 'GROQ_FREE', { quota: { requestQuotaRemaining: 0, tokenQuotaRemaining: 'unknown', lastUpdatedAt: new Date().toISOString(), resetAt: 'unknown' } });
  assert.equal(exhausted.classification, 'FREE_QUOTA_EXHAUSTED');
});

test('NVIDIA Developer is dev/eval only even if a test injects zero-cost evidence', () => {
  const model = chat('qwen/qwen2.5-coder-32b-instruct', 'FREE_TIER_ELIGIBLE');
  assert.equal(policy('nvidia-nim', model, 'NVIDIA_DEVELOPER').classification, 'DEV_EVAL_ONLY');
  const evalDecision = policy('nvidia-nim', model, 'NVIDIA_DEVELOPER', { usageContext: 'DEV_EVAL' });
  requireZeroCostDecision(evalDecision, 'nvidia-nim', model.id);
});
