import { providers } from './catalog.js';
import { CredentialBroker } from './broker.js';
import { AutopilotStateStore } from './state-store.js';
import { buildComputeInventory } from './inventory.js';
import { declaredProviderAccountPlan, installationBillingPosture, observedEconomicQuota, readAccountCostEvidence, resolveZeroCostExecution, type ZeroCostDecision } from './economics.js';
import { ProviderBillingCapabilityInspector } from './billing-capability.js';
import type { CredentialDescriptor } from '@beyonder/credentials';

export interface ZeroCostInventoryRow {
  provider: string; model: string; credentialAccess: boolean; credential: CredentialDescriptor;
  bootstrapReady: boolean; catalogStatus: string;
  costClass: ZeroCostDecision['costClass']; costEvidenceSource: ZeroCostDecision['source'];
  freeQuota: ZeroCostDecision['freeQuota']; billingSpillover: ZeroCostDecision['billingSpilloverPossible'];
  zeroCostReady: boolean; inferenceQualified: false | 'UNKNOWN'; verifierQualified: false | 'UNKNOWN';
  reason: string; economics: ZeroCostDecision;
}
export async function zeroCostInventory(statePath: string, broker = new CredentialBroker({}, process.env, { providerStatePath: statePath })): Promise<ZeroCostInventoryRow[]> {
  const state = await new AutopilotStateStore(statePath).read();
  const evidence = await readAccountCostEvidence();
  const inspector = new ProviderBillingCapabilityInspector(broker);
  const inventory = buildComputeInventory(state);
  const rows: ZeroCostInventoryRow[] = [];
  for (const provider of providers) {
    const resolved = await broker.resolve(provider.id);
    const credential = resolved.descriptor;
    const accountPlan = declaredProviderAccountPlan(provider.id, resolved.apiKey(), resolved.get('CLOUDFLARE_ACCOUNT_ID'));
    const billingCapability = ['gemini', 'groq', 'cloudflare-workers-ai'].includes(provider.id) ? await inspector.inspect(provider.id) : undefined;
    const entry = inventory.find(e => e.providerId === provider.id)!;
    for (const model of entry.modelMetadata.length ? entry.modelMetadata : [{ id: '(no observed model)', capabilities: [] }]) {
      const progress = state.providers[provider.id];
      const economics = resolveZeroCostExecution({ provider, model, credential, accountPlan, billingCapability, installationPosture: installationBillingPosture(), accountEvidence: evidence.find(e => e.provider === provider.id && e.model === model.id), quota: observedEconomicQuota(progress) });
      const operational = entry.bootstrapReady === true && entry.modelCatalogReady === true;
      const zeroCostReady = credential.accessible && credential.valid !== false && operational && economics.zeroCostExecutionGuaranteed;
      rows.push({ provider: provider.id, model: model.id, credentialAccess: credential.accessible, credential, bootstrapReady: entry.bootstrapReady === true, catalogStatus: state.providers[provider.id]?.validation?.status ?? 'not-run', costClass: economics.costClass, costEvidenceSource: economics.source, freeQuota: economics.freeQuota, billingSpillover: economics.billingSpilloverPossible, zeroCostReady, inferenceQualified: zeroCostReady ? 'UNKNOWN' : false, verifierQualified: zeroCostReady ? 'UNKNOWN' : false, reason: !credential.accessible ? `credential:${credential.status}` : !operational ? 'Bootstrap/catalog not observed; neither skipped validation nor keyless is inference qualification.' : economics.reason, economics });
    }
  }
  return rows;
}
