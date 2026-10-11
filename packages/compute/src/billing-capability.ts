import { createSign } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CredentialBroker } from './broker.js';
import { providerCredentialFingerprint } from './economics.js';

export type BillingCapability = 'NO_BILLING_CAPABILITY' | 'BILLING_CAPABILITY_PRESENT' | 'BILLING_CAPABILITY_UNKNOWN';
export interface BillingCapabilityEvidence {
  provider: string;
  credentialSha256: string;
  capability: BillingCapability;
  source: 'GOOGLE_CLOUD_BILLING_API' | 'CLOUDFLARE_SUBSCRIPTIONS_API' | 'CLOUDFLARE_SUBSCRIPTIONS_AND_PAYMENT_METHODS' | 'NO_SUPPORTED_INTROSPECTION' | 'INSPECTION_UNAVAILABLE';
  checkedAt: string;
  reason: string;
  contradicted?: true;
}

const KNOWN_PROVIDERS = new Set(['gemini', 'groq', 'cloudflare-workers-ai']);
const BOUNDED_PROBE_MS = 10_000;
const FREE_STATE_TTL_MS = 60 * 60_000;
const OTHER_STATE_TTL_MS = 5 * 60_000;
const inactiveSubscription = (state: unknown) => ['Cancelled', 'Failed', 'Expired'].includes(String(state));
const asRecord = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Read-only, provider-native account inspection. Quota and model prices remain separate inputs. */
export class ProviderBillingCapabilityInspector {
  private readonly inFlight = new Map<string, Promise<BillingCapabilityEvidence>>();
  private readonly checkedThisProcess = new Map<string, BillingCapabilityEvidence>();
  constructor(private readonly broker: CredentialBroker, private readonly statePath = join(dirname(broker.providerStatePath), 'billing-capability.json'), private readonly fetchImpl: typeof fetch = fetch, private readonly env: NodeJS.ProcessEnv = process.env) {}

  async inspect(provider: string): Promise<BillingCapabilityEvidence> {
    const resolved = await this.broker.resolve(provider);
    const key = resolved.apiKey();
    const accountId = resolved.get('CLOUDFLARE_ACCOUNT_ID');
    const fingerprint = key ? providerCredentialFingerprint(provider, key, accountId) : '';
    const unknown = (source: BillingCapabilityEvidence['source'], reason: string): BillingCapabilityEvidence => ({ provider, credentialSha256: fingerprint, capability: 'BILLING_CAPABILITY_UNKNOWN', source, checkedAt: new Date().toISOString(), reason });
    if (!KNOWN_PROVIDERS.has(provider) || !resolved.descriptor.accessible || !key || provider === 'cloudflare-workers-ai' && !accountId) return unknown('INSPECTION_UNAVAILABLE', 'Credential or supported inspection endpoint unavailable.');
    const persisted = await this.cached(provider);
    if (persisted?.credentialSha256 === fingerprint && persisted.contradicted === true) return persisted;
    const current = this.checkedThisProcess.get(provider);
    if (current?.credentialSha256 === fingerprint && Date.now() - Date.parse(current.checkedAt) < (current.capability === 'NO_BILLING_CAPABILITY' ? FREE_STATE_TTL_MS : OTHER_STATE_TTL_MS)) return current;
    const pending = this.inFlight.get(provider);
    if (pending) return pending;
    const inspection = (async () => {
      const result = provider === 'gemini' ? await this.inspectGemini(key, fingerprint)
        : provider === 'cloudflare-workers-ai' ? await this.inspectCloudflare(key, accountId!, fingerprint)
        : unknown('NO_SUPPORTED_INTROSPECTION', 'Groq public API exposes models and rate limits, but no documented account billing-capability endpoint.');
      this.checkedThisProcess.set(provider, result);
      await this.persist(result);
      return result;
    })().finally(() => this.inFlight.delete(provider));
    this.inFlight.set(provider, inspection);
    return inspection;
  }

  async invalidate(provider: string): Promise<void> {
    const resolved = await this.broker.resolve(provider);
    const key = resolved.apiKey();
    const evidence: BillingCapabilityEvidence = { provider, credentialSha256: key ? providerCredentialFingerprint(provider, key, resolved.get('CLOUDFLARE_ACCOUNT_ID')) : '', capability: 'BILLING_CAPABILITY_UNKNOWN', source: 'INSPECTION_UNAVAILABLE', checkedAt: new Date().toISOString(), reason: 'Provider response contradicted the prior zero-cost decision; new execution is stopped for this credential.', contradicted: true };
    this.checkedThisProcess.set(provider, evidence);
    await this.persist(evidence);
  }

  async cached(provider: string): Promise<BillingCapabilityEvidence | undefined> {
    return (await this.readState()).providers[provider];
  }

  private async inspectGemini(key: string, fingerprint: string): Promise<BillingCapabilityEvidence> {
    const result = (capability: BillingCapability, source: BillingCapabilityEvidence['source'], reason: string): BillingCapabilityEvidence => ({ provider: 'gemini', credentialSha256: fingerprint, capability, source, checkedAt: new Date().toISOString(), reason });
    const oauthToken = await this.googleReadToken();
    if (!oauthToken) return result('BILLING_CAPABILITY_UNKNOWN', 'INSPECTION_UNAVAILABLE', 'Gemini API key does not authorize Google Cloud billing reads; no OAuth read credential is available.');
    try {
      const lookup = await this.fetchImpl(`https://apikeys.googleapis.com/v2/keys:lookupKey?keyString=${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${oauthToken}` }, signal: AbortSignal.timeout(BOUNDED_PROBE_MS), redirect: 'error' });
      if (!lookup.ok) return result('BILLING_CAPABILITY_UNKNOWN', 'INSPECTION_UNAVAILABLE', `Google API key lookup returned HTTP ${lookup.status}.`);
      const parent = asRecord(await lookup.json())?.parent;
      if (typeof parent !== 'string' || !/^projects\/[a-zA-Z0-9-]+$/.test(parent)) return result('BILLING_CAPABILITY_UNKNOWN', 'INSPECTION_UNAVAILABLE', 'Google API key lookup did not identify a project.');
      const billing = await this.fetchImpl(`https://cloudbilling.googleapis.com/v1/${parent}/billingInfo`, { headers: { Authorization: `Bearer ${oauthToken}` }, signal: AbortSignal.timeout(BOUNDED_PROBE_MS), redirect: 'error' });
      if (!billing.ok) return result('BILLING_CAPABILITY_UNKNOWN', 'INSPECTION_UNAVAILABLE', `Google Cloud billing lookup returned HTTP ${billing.status}.`);
      const enabled = asRecord(await billing.json())?.billingEnabled;
      return enabled === false ? result('NO_BILLING_CAPABILITY', 'GOOGLE_CLOUD_BILLING_API', 'Google Cloud reports billingEnabled=false for the API key project.')
        : enabled === true ? result('BILLING_CAPABILITY_PRESENT', 'GOOGLE_CLOUD_BILLING_API', 'Google Cloud reports billingEnabled=true for the API key project.')
        : result('BILLING_CAPABILITY_UNKNOWN', 'INSPECTION_UNAVAILABLE', 'Google Cloud billing response omitted billingEnabled.');
    } catch { return result('BILLING_CAPABILITY_UNKNOWN', 'INSPECTION_UNAVAILABLE', 'Google Cloud billing inspection failed.'); }
  }

  private async inspectCloudflare(key: string, accountId: string, fingerprint: string): Promise<BillingCapabilityEvidence> {
    const result = (capability: BillingCapability, source: BillingCapabilityEvidence['source'], reason: string): BillingCapabilityEvidence => ({ provider: 'cloudflare-workers-ai', credentialSha256: fingerprint, capability, source, checkedAt: new Date().toISOString(), reason });
    const token = this.env.CLOUDFLARE_BILLING_API_TOKEN || key;
    const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
    const get = async (suffix: string) => {
      const response = await this.fetchImpl(`${base}/${suffix}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(BOUNDED_PROBE_MS), redirect: 'error' });
      return { status: response.status, body: response.ok ? asRecord(await response.json()) : undefined };
    };
    try {
      const subscriptions = await get('subscriptions?per_page=100');
      const entries = subscriptions.body?.result;
      const info = asRecord(subscriptions.body?.result_info);
      if (subscriptions.status !== 200 || subscriptions.body?.success !== true || !Array.isArray(entries) || typeof info?.total_count !== 'number' || info.total_count > entries.length) return result('BILLING_CAPABILITY_UNKNOWN', 'INSPECTION_UNAVAILABLE', `Cloudflare account subscriptions unavailable or incomplete (HTTP ${subscriptions.status}).`);
      let freeWorkers = false;
      for (const entry of entries) {
        const row = asRecord(entry), plan = asRecord(row?.rate_plan);
        if (!row || !plan || inactiveSubscription(row.state)) continue;
        const id = String(plan.id ?? '').toLowerCase(), name = String(plan.public_name ?? '').toLowerCase();
        if (id === 'workers_paid' || /workers? paid/.test(name)) return result('BILLING_CAPABILITY_PRESENT', 'CLOUDFLARE_SUBSCRIPTIONS_API', 'Nonterminal Workers Paid subscription found.');
        if (id === 'workers_free' || /workers? free/.test(name)) {
          if (row.state !== 'Provisioned') return result('BILLING_CAPABILITY_UNKNOWN', 'CLOUDFLARE_SUBSCRIPTIONS_API', 'Workers Free subscription has an unexpected state.');
          freeWorkers = true;
        }
        else if (id.includes('worker') || name.includes('worker')) return result('BILLING_CAPABILITY_UNKNOWN', 'CLOUDFLARE_SUBSCRIPTIONS_API', 'Unrecognized Workers subscription; billing capability cannot be excluded.');
      }
      if (freeWorkers) return result('NO_BILLING_CAPABILITY', 'CLOUDFLARE_SUBSCRIPTIONS_API', 'Active Workers Free subscription and no active Workers Paid subscription.');
      const payments = await get('payment-methods?per_page=100');
      const methods = payments.body?.result;
      const paymentInfo = asRecord(payments.body?.result_info);
      if (payments.status === 200 && payments.body?.success === true && Array.isArray(methods) && methods.length === 0 && paymentInfo?.total_count === 0) return result('NO_BILLING_CAPABILITY', 'CLOUDFLARE_SUBSCRIPTIONS_AND_PAYMENT_METHODS', 'No Workers Paid subscription or account payment method found in complete account reads.');
      return result('BILLING_CAPABILITY_UNKNOWN', 'INSPECTION_UNAVAILABLE', `No explicit Workers plan and payment-method status is not conclusively empty (HTTP ${payments.status}).`);
    } catch { return result('BILLING_CAPABILITY_UNKNOWN', 'INSPECTION_UNAVAILABLE', 'Cloudflare billing inspection failed.'); }
  }

  private async googleReadToken(): Promise<string | undefined> {
    if (this.env.GOOGLE_CLOUD_ACCESS_TOKEN) return this.env.GOOGLE_CLOUD_ACCESS_TOKEN;
    const path = this.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!path) return undefined;
    try {
      const credentials = asRecord(JSON.parse(await readFile(path, 'utf8')));
      if (credentials?.type !== 'service_account' || typeof credentials.client_email !== 'string' || typeof credentials.private_key !== 'string' || credentials.token_uri !== 'https://oauth2.googleapis.com/token') return undefined;
      const now = Math.floor(Date.now() / 1000);
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const header = encode({ alg: 'RS256', typ: 'JWT' });
      const payload = encode({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform.read-only https://www.googleapis.com/auth/cloud-billing.readonly', aud: credentials.token_uri, iat: now, exp: now + 3600 });
      const input = `${header}.${payload}`;
      const signature = createSign('RSA-SHA256').update(input).sign(credentials.private_key, 'base64url');
      const response = await this.fetchImpl(credentials.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${signature}` }), signal: AbortSignal.timeout(BOUNDED_PROBE_MS), redirect: 'error' });
      if (!response.ok) return undefined;
      const token = asRecord(await response.json())?.access_token;
      return typeof token === 'string' ? token : undefined;
    } catch { return undefined; }
  }

  private async readState(): Promise<{ version: 1; providers: Record<string, BillingCapabilityEvidence> }> {
    try {
      const raw = await readFile(this.statePath, 'utf8');
      if (raw.length > 65_536) throw new Error('oversized');
      const parsed = JSON.parse(raw) as { version?: unknown; providers?: unknown };
      if (parsed.version === 1 && asRecord(parsed.providers)) return { version: 1, providers: parsed.providers as Record<string, BillingCapabilityEvidence> };
    } catch { /* Absence or malformed cache is not account evidence. */ }
    return { version: 1, providers: {} };
  }

  private async persist(evidence: BillingCapabilityEvidence): Promise<void> {
    try { const state = await this.readState(); state.providers[evidence.provider] = evidence; await this.writeState(state); }
    catch { /* Persistence failure does not turn unknown into free. */ }
  }
  private async writeState(state: { version: 1; providers: Record<string, BillingCapabilityEvidence> }): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, this.statePath);
  }
}
