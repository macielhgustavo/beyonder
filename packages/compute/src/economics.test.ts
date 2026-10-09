import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProvider } from './catalog.js';
import { buildComputeInventory } from './inventory.js';
import { resolveZeroCostExecution, requireZeroCostDecision, readAccountCostEvidence, type AccountCostEvidence } from './economics.js';
import type { CredentialDescriptor } from '@beyonder/credentials';

const now = Date.now();
const timestamp = new Date(now).toISOString();
const credential: CredentialDescriptor = { identity: 'credential://provider/gemini', provider: 'gemini', expected: true, configured: true, present: true, accessible: true, valid: true, source: 'ENV_COMPATIBILITY', scope: ['inference'], status: 'CREDENTIAL_ACCESSIBLE', lastValidated: timestamp };
const evidence: AccountCostEvidence = { version: 1, provider: 'gemini', model: 'gemini-2.5-flash', endpoint: getProvider('gemini')!.openAiCompatibleEndpoint!, source: 'provider-account-api', checkedAt: timestamp, expiresAt: new Date(now + 60_000).toISOString(), credentialSource: 'ENV_COMPATIBILITY', credentialLastValidated: timestamp, accountBillingState: 'DISABLED', freeTierEligible: true, freeQuota: 'AVAILABLE', spendCap: 'NONE', providerBillingBehavior: 'REJECT_AFTER_FREE_QUOTA', billingSpilloverPossible: false };
function account(patch: Partial<AccountCostEvidence> = {}, costClass: 'FREE_TIER_ELIGIBLE' | 'UNKNOWN_COST' | 'PAID' = 'FREE_TIER_ELIGIBLE') { return resolveZeroCostExecution({ provider: getProvider('gemini')!, model: { id: evidence.model, capabilities: ['CHAT'], costClass }, credential, accountEvidence: { ...evidence, ...patch }, now }); }
test('A: free eligibility + current free quota + no spillover is eligible', () => { const d = account(); assert.equal(d.classification, 'FREE_QUOTA_CONFIRMED'); assert.equal(d.zeroCostExecutionGuaranteed, true); assert.deepEqual(d.monetaryCost, { state: 'CONFIRMED_ZERO', usd: 0 }); });
test('B: exhausted free quota rejects without inventing zero', () => { const d = account({ freeQuota: 'EXHAUSTED' }); assert.equal(d.classification, 'FREE_QUOTA_EXHAUSTED'); assert.deepEqual(d.monetaryCost, { state: 'UNKNOWN' }); });
for (const costClass of ['UNKNOWN_COST', 'PAID'] as const) test(`C/D/F: valid credential cannot qualify ${costClass}`, () => { const d = resolveZeroCostExecution({ provider: getProvider('gemini')!, model: { id: evidence.model, capabilities: ['CHAT'], costClass }, credential, now }); assert.equal(d.zeroCostExecutionGuaranteed, false); assert.equal(d.classification, costClass); });
test('E: free quota on billing-enabled spillover account is rejected', () => assert.equal(account({ accountBillingState: 'ENABLED', providerBillingBehavior: 'MAY_CHARGE', billingSpilloverPossible: true }).classification, 'BILLING_RISK'));
test('account billing unknown is distinct from price and free tier', () => assert.equal(account({ accountBillingState: 'UNKNOWN' }).classification, 'BILLING_STATE_UNKNOWN'));
test('enabled billing with effective zero cap can qualify only with no spillover', () => assert.equal(account({ accountBillingState: 'ENABLED', spendCap: 'ENFORCED_ZERO' }).zeroCostExecutionGuaranteed, true));
test('unknown price can be qualified by independent current account evidence, not by assuming zero', () => assert.equal(account({}, 'UNKNOWN_COST').classification, 'FREE_QUOTA_CONFIRMED'));
test('paid stays disabled even with account cap/evidence', () => assert.equal(account({ spendCap: 'ENFORCED_ZERO' }, 'PAID').classification, 'PAID'));
test('freshness, scope and credential revision are mandatory', () => { for (const patch of [{ provider: 'groq' }, { model: 'other-model' }, { endpoint: 'https://other.test' }, { checkedAt: new Date(now - 600_000).toISOString() }, { expiresAt: timestamp }, { credentialLastValidated: 'old' }] as Partial<AccountCostEvidence>[]) assert.equal(account(patch).zeroCostExecutionGuaranteed, false); });
test('free tier alone is not a zero-cost guarantee', () => assert.equal(resolveZeroCostExecution({ provider: getProvider('gemini')!, model: { id: evidence.model, capabilities: ['CHAT'], costClass: 'FREE_TIER_ELIGIBLE' }, now }).classification, 'BILLING_STATE_UNKNOWN'));
test('G/H: READY/keyless never turns paid into free; K skipped Horde is not inference-qualified', () => {
 const state = { version: 1 as const, updatedAt: timestamp, providers: { 'ai-horde': { providerId: 'ai-horde', state: 'READY' as const, classification: 'KEYLESS' as const, attempts: 1, lastUpdatedAt: timestamp, validation: { status: 'skipped' as const } } } };
 const row = buildComputeInventory(state).find(e => e.providerId === 'ai-horde')!; assert.equal(row.bootstrapReady, true); assert.equal(row.modelCatalogReady, false); assert.equal(row.inferenceQualified, false); assert.equal(row.verifierQualified, false); assert.equal(row.cost, 'unknown');
 assert.equal(resolveZeroCostExecution({ provider: getProvider('kilo-gateway')!, model: { id: 'vendor/paid', capabilities: ['CHAT'], costClass: 'PAID' }, now }).classification, 'PAID');
});
test('fixed free route + fresh live all-zero pricing has explicit provenance', () => {
 const input = { provider: getProvider('openrouter')!, model: { id: 'vendor/model:free', capabilities: ['CHAT' as const], costClass: 'FREE_TIER_ELIGIBLE' as const, costEvidence: { source: 'live-catalog' as const, observedAt: timestamp, zeroPrice: true } }, now };
 const d = resolveZeroCostExecution(input); assert.equal(d.zeroCostExecutionGuaranteed, true); assert.equal(d.freeQuota, 'UNKNOWN'); assert.equal(d.billingSpilloverPossible, false); assert.equal(d.source, 'EXPLICIT_FREE_ROUTE_AND_LIVE_PRICE');
 assert.equal(resolveZeroCostExecution({ ...input, provider: getProvider('groq')! }).zeroCostExecutionGuaranteed, false);
 assert.equal(resolveZeroCostExecution({ ...input, model: { ...input.model, costEvidence: undefined } }).zeroCostExecutionGuaranteed, false);
 assert.equal(resolveZeroCostExecution({ ...input, quota: { requestQuotaRemaining: 0, tokenQuotaRemaining: 'unknown', resetAt: 'unknown', lastUpdatedAt: timestamp } }).classification, 'FREE_QUOTA_EXHAUSTED');
});
test('official OpenRouter free router does not depend on per-model pricing metadata', () => {
 const d = resolveZeroCostExecution({ provider: getProvider('openrouter')!, model: { id: 'openrouter/free', capabilities: ['OTHER'], costClass: 'FREE_TIER_ELIGIBLE' }, now });
 assert.equal(d.classification, 'ZERO_COST_CONFIRMED');
 assert.equal(d.source, 'OFFICIAL_FREE_ROUTER');
 assert.equal(d.zeroCostExecutionGuaranteed, true);
 assert.deepEqual(d.monetaryCost, { state: 'CONFIRMED_ZERO', usd: 0 });
});
test('L: unknown never serializes as monetaryCostUsd=0', () => { const d = resolveZeroCostExecution({ provider: getProvider('groq')!, model: { id: 'dynamic-model', capabilities: ['CHAT'] }, now }); assert.deepEqual(d.monetaryCost, { state: 'UNKNOWN' }); assert.throws(() => requireZeroCostDecision(d, 'groq', 'dynamic-model', now)); });
test('expired/copied/mismatched economic proof cannot authorize a physical attempt', () => { const d = account(); for (const [p,m,t] of [['groq',d.model,now],[d.provider,'other',now],[d.provider,d.model,now+120_000]] as const) assert.throws(() => requireZeroCostDecision(d,p,m,t)); });
test('authorized evidence loader is allowlisted and never returns extra secret fields', async () => {
 const dir = await mkdtemp(join(tmpdir(),'cost-proof-')); try {const path=join(dir,'proof.json'); await writeFile(path,JSON.stringify({version:1,accounts:[{...evidence,token:'opaque-test-secret',authorization:'opaque-test-secret'}]})); assert.ok(!(JSON.stringify(await readAccountCostEvidence(path))).includes('opaque-test-secret')); await writeFile(path,'opaque-test-secret'); assert.deepEqual(await readAccountCostEvidence(path),[]);} finally { await rm(dir,{recursive:true,force:true}); }
});
