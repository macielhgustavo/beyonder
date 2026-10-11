import type { ZeroCostDecision } from '@beyonder/compute';
/** Explicit controlled-test evidence, never loaded by production or persisted to BIB. */
export function fixtureZeroCost(provider: string, model: string): ZeroCostDecision {
 const now = Date.now(); return { version: 1, provider, model, costClass: 'FREE_CONFIRMED', classification: 'FREE_QUOTA_CONFIRMED', source: 'operator-verified-account', checkedAt: new Date(now).toISOString(), expiresAt: new Date(now+60_000).toISOString(), accountBillingState: 'DISABLED', freeTierEligible: true, freeQuota: 'AVAILABLE', spendCap: 'ENFORCED_ZERO', providerBillingBehavior: 'REJECT_AFTER_FREE_QUOTA', billingSpilloverPossible: false, zeroCostExecutionGuaranteed: true, monetaryCost: { state:'CONFIRMED_ZERO',usd:0 }, reason: 'Controlled economic proof fixture, not live account evidence.' };
}
