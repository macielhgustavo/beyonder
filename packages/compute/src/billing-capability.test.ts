import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialBroker } from './broker.js';
import { ProviderBillingCapabilityInspector } from './billing-capability.js';
import { getProvider } from './catalog.js';
import { resolveZeroCostExecution, requireZeroCostDecision } from './economics.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const location = async () => join(await mkdtemp(join(tmpdir(), 'beyonder-billing-capability-')), 'providers.json');

test('Gemini discovers no billing through official key lookup plus project billing API; no plan fingerprint is needed', async () => {
  const path = await location();
  const broker = new CredentialBroker({}, { GEMINI_API_KEY: 'test-gemini-key' }, { providerStatePath: path });
  const calls: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = String(input); calls.push(url.split('?')[0]!);
    if (url.includes('lookupKey')) return json({ parent: 'projects/123456' });
    if (url.includes('/billingInfo')) return json({ billingEnabled: false });
    throw new Error('unexpected endpoint');
  };
  const inspector = new ProviderBillingCapabilityInspector(broker, undefined, fetcher, { GOOGLE_CLOUD_ACCESS_TOKEN: 'test-oauth-token' });
  const evidence = await inspector.inspect('gemini');
  assert.equal(evidence.capability, 'NO_BILLING_CAPABILITY');
  assert.equal(evidence.source, 'GOOGLE_CLOUD_BILLING_API');
  const decision = resolveZeroCostExecution({ provider: getProvider('gemini')!, model: { id: 'gemini-2.5-flash', capabilities: ['CHAT'] }, billingCapability: evidence });
  requireZeroCostDecision(decision, 'gemini', 'gemini-2.5-flash');
  assert.equal(decision.source, 'PROVIDER_BILLING_API');
  const quotaUnknown = resolveZeroCostExecution({ provider: getProvider('gemini')!, model: { id: 'gemini-2.5-flash', capabilities: ['CHAT'] }, billingCapability: evidence, quota: { requestQuotaRemaining: 'unknown', tokenQuotaRemaining: 'unknown', lastUpdatedAt: 'unknown', resetAt: 'unknown' } });
  assert.equal(quotaUnknown.zeroCostExecutionGuaranteed, true);
  const quotaExhausted = resolveZeroCostExecution({ provider: getProvider('gemini')!, model: { id: 'gemini-2.5-flash', capabilities: ['CHAT'] }, billingCapability: evidence, quota: { requestQuotaRemaining: 0, tokenQuotaRemaining: 'unknown', lastUpdatedAt: new Date().toISOString(), resetAt: new Date(Date.now() + 60_000).toISOString() } });
  assert.equal(quotaExhausted.classification, 'FREE_QUOTA_EXHAUSTED');
  assert.equal((await inspector.inspect('gemini')).capability, 'NO_BILLING_CAPABILITY');
  assert.equal(calls.length, 2, 'stable billing state is cached within the process');
  assert.equal((await inspector.cached('gemini'))?.capability, 'NO_BILLING_CAPABILITY');
});

test('Gemini paid billing beats an exceptional manual free declaration', async () => {
  const broker = new CredentialBroker({}, { GEMINI_API_KEY: 'test-gemini-key' }, { providerStatePath: await location() });
  const fetcher: typeof fetch = async input => String(input).includes('lookupKey') ? json({ parent: 'projects/123456' }) : json({ billingEnabled: true });
  const evidence = await new ProviderBillingCapabilityInspector(broker, undefined, fetcher, { GOOGLE_CLOUD_ACCESS_TOKEN: 'test-oauth-token' }).inspect('gemini');
  assert.equal(evidence.capability, 'BILLING_CAPABILITY_PRESENT');
  assert.equal(resolveZeroCostExecution({ provider: getProvider('gemini')!, model: { id: 'gemini-2.5-flash', capabilities: ['CHAT'] }, accountPlan: 'GEMINI_FREE', billingCapability: evidence }).classification, 'BILLING_RISK');
});

test('Gemini service account requests the distinct read scopes required by key lookup and billing info', async () => {
  const path = await location();
  const credentialsPath = join(await mkdtemp(join(tmpdir(), 'beyonder-google-read-')), 'service-account.json');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  await writeFile(credentialsPath, JSON.stringify({ type: 'service_account', client_email: 'reader@example.test', private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token' }));
  let requestedScope = '';
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/token')) {
      const assertion = new URLSearchParams(init?.body as URLSearchParams).get('assertion')!;
      requestedScope = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString()).scope as string;
      return json({ access_token: 'test-oauth-token' });
    }
    if (url.includes('lookupKey')) return json({ parent: 'projects/123456' });
    if (url.includes('/billingInfo')) return json({ billingEnabled: false });
    throw new Error('unexpected endpoint');
  };
  const broker = new CredentialBroker({}, { GEMINI_API_KEY: 'test-gemini-key' }, { providerStatePath: path });
  const evidence = await new ProviderBillingCapabilityInspector(broker, undefined, fetcher, { GOOGLE_APPLICATION_CREDENTIALS: credentialsPath }).inspect('gemini');
  assert.equal(evidence.capability, 'NO_BILLING_CAPABILITY');
  assert.equal(requestedScope, 'https://www.googleapis.com/auth/cloud-platform.read-only https://www.googleapis.com/auth/cloud-billing.readonly');
});

test('Cloudflare Workers Free is discovered from subscription metadata; Workers Paid blocks', async () => {
  for (const [plan, expected] of [['Workers Free', 'NO_BILLING_CAPABILITY'], ['Workers Paid', 'BILLING_CAPABILITY_PRESENT']] as const) {
    const broker = new CredentialBroker({}, { CLOUDFLARE_ACCOUNT_ID: 'account-test', CLOUDFLARE_API_TOKEN: 'test-token' }, { providerStatePath: await location() });
    const fetcher: typeof fetch = async () => json({ success: true, result: [{ state: 'Provisioned', rate_plan: { public_name: plan, scope: 'account' } }], result_info: { total_count: 1 } });
    const evidence = await new ProviderBillingCapabilityInspector(broker, undefined, fetcher).inspect('cloudflare-workers-ai');
    assert.equal(evidence.capability, expected);
    const decision = resolveZeroCostExecution({ provider: getProvider('cloudflare-workers-ai')!, model: { id: '@cf/zai-org/glm-4.7-flash', capabilities: ['CHAT'], costClass: 'PAID' }, billingCapability: evidence });
    assert.equal(decision.zeroCostExecutionGuaranteed, plan === 'Workers Free');
  }
  const broker = new CredentialBroker({}, { CLOUDFLARE_ACCOUNT_ID: 'account-test', CLOUDFLARE_API_TOKEN: 'test-token' }, { providerStatePath: await location() });
  const ambiguous: typeof fetch = async () => json({ success: true, result: [{ state: 'Trial', rate_plan: { public_name: 'Workers Free' } }], result_info: { total_count: 1 } });
  assert.equal((await new ProviderBillingCapabilityInspector(broker, undefined, ambiguous).inspect('cloudflare-workers-ai')).capability, 'BILLING_CAPABILITY_UNKNOWN');
});

test('Cloudflare complete no-subscription and no-payment-method reads establish no billing; 403 stays unknown', async () => {
  const broker = new CredentialBroker({}, { CLOUDFLARE_ACCOUNT_ID: 'account-test', CLOUDFLARE_API_TOKEN: 'test-token' }, { providerStatePath: await location() });
  const empty: typeof fetch = async () => json({ success: true, result: [], result_info: { total_count: 0 } });
  assert.equal((await new ProviderBillingCapabilityInspector(broker, undefined, empty).inspect('cloudflare-workers-ai')).capability, 'NO_BILLING_CAPABILITY');
  const denied: typeof fetch = async () => json({ success: false }, 403);
  assert.equal((await new ProviderBillingCapabilityInspector(broker, undefined, denied).inspect('cloudflare-workers-ai')).capability, 'BILLING_CAPABILITY_UNKNOWN');
  const incomplete: typeof fetch = async input => String(input).includes('payment-methods')
    ? json({ success: true, result: [] })
    : json({ success: true, result: [], result_info: { total_count: 0 } });
  assert.equal((await new ProviderBillingCapabilityInspector(broker, undefined, incomplete).inspect('cloudflare-workers-ai')).capability, 'BILLING_CAPABILITY_UNKNOWN');
});

test('credential rotation does not inherit billing evidence or a contradiction marker', async () => {
  const path = await location();
  const fetcher: typeof fetch = async () => json({ success: true, result: [], result_info: { total_count: 0 } });
  const first = new ProviderBillingCapabilityInspector(new CredentialBroker({}, { CLOUDFLARE_ACCOUNT_ID: 'account-test', CLOUDFLARE_API_TOKEN: 'first-token' }, { providerStatePath: path }), undefined, fetcher);
  const previous = await first.inspect('cloudflare-workers-ai');
  await first.invalidate('cloudflare-workers-ai');
  assert.equal((await first.inspect('cloudflare-workers-ai')).contradicted, true);
  const rotated = new ProviderBillingCapabilityInspector(new CredentialBroker({}, { CLOUDFLARE_ACCOUNT_ID: 'account-test', CLOUDFLARE_API_TOKEN: 'rotated-token' }, { providerStatePath: path }), undefined, fetcher);
  const next = await rotated.inspect('cloudflare-workers-ai');
  assert.equal(next.capability, 'NO_BILLING_CAPABILITY');
  assert.notEqual(next.credentialSha256, previous.credentialSha256);
});

test('Groq public model API is not misread as billing evidence; exceptional override remains possible', async () => {
  const broker = new CredentialBroker({}, { GROQ_API_KEY: 'test-groq-key' }, { providerStatePath: await location() });
  const never: typeof fetch = async () => { throw new Error('No documented Groq account billing endpoint'); };
  const evidence = await new ProviderBillingCapabilityInspector(broker, undefined, never).inspect('groq');
  assert.equal(evidence.capability, 'BILLING_CAPABILITY_UNKNOWN');
  assert.equal(resolveZeroCostExecution({ provider: getProvider('groq')!, model: { id: 'openai/gpt-oss-120b', capabilities: ['CHAT'] }, billingCapability: evidence }).classification, 'BILLING_STATE_UNKNOWN');
  assert.equal(resolveZeroCostExecution({ provider: getProvider('groq')!, model: { id: 'openai/gpt-oss-120b', capabilities: ['CHAT'] }, billingCapability: evidence, accountPlan: 'GROQ_FREE' }).zeroCostExecutionGuaranteed, true);
});
