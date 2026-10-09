import 'dotenv/config';
import { AutopilotStateStore, CredentialBroker, getProvider, validateProviderDetailed, zeroCostInventory, providerCredentialFingerprint } from '@beyonder/compute';
import { loadConfig, ModelRouter, physicalModelIdentity, classifyFailure, InferenceError, runCandidates, openDatabase, StateStore, type InferenceAttempt, type ModelCandidate } from '@beyonder/runtime';
import { randomUUID } from 'node:crypto';

const command = process.argv[2];
const args = process.argv.slice(3);
function option(name: string) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
async function main() {
  if (!['inventory', 'smoke', 'plan-fingerprint'].includes(command)) throw new Error('Use inventory, smoke or plan-fingerprint.');
  const providerId = option('--provider'), requestedModel = option('--model');
  if (command === 'smoke' && (!providerId || !requestedModel)) throw new Error('Smoke requires explicit --provider and --model; one short call, no retries.');
  const config = loadConfig({ ...process.env, BEYONDER_MODEL_PROVIDER: 'auto' });
  const store = new AutopilotStateStore(config.model.providerStatePath);
  const broker = new CredentialBroker({}, process.env, { providerStatePath: config.model.providerStatePath });
  if (command === 'plan-fingerprint') {
    if (!providerId || !['gemini', 'groq', 'cloudflare-workers-ai', 'nvidia-nim'].includes(providerId)) throw new Error('Specify a provider supported by native plan policy.');
    const credential = await broker.resolve(providerId);
    if (!credential.descriptor.accessible || !credential.apiKey()) throw new Error('Credential is unavailable.');
    console.log(JSON.stringify({ provider: providerId, credentialSha256: providerCredentialFingerprint(providerId, credential.apiKey()!, credential.get('CLOUDFLARE_ACCOUNT_ID')), accountPlan: 'OPERATOR_VERIFICATION_REQUIRED' }));
    return;
  }
  if (args.includes('--refresh-catalog')) {
    const provider = providerId && getProvider(providerId);
    if (!provider) throw new Error('Catalogue refresh requires an explicit supported --provider.');
    const report = await validateProviderDetailed({ ...provider, validation: { ...provider.validation, method: provider.authType === 'keyless' ? 'keyless-models' : provider.validation?.method ?? 'none', url: provider.validation?.url ?? `${provider.openAiCompatibleEndpoint}/models` } }, broker);
    if (report.status.validationStatus === 'validated') {
      await store.update(provider, 'READY', { validation: { status: 'validated', models: report.models, modelMetadata: report.modelMetadata, modelCount: report.modelCount, rateLimitHeaders: report.rateLimitHeaders, latencyMs: report.latencyMs } });
    }
  }
  const rows = (await zeroCostInventory(config.model.providerStatePath, broker)).filter(row => (!providerId || row.provider === providerId) && (!requestedModel || row.model === requestedModel));
  if (command === 'inventory') { console.log(JSON.stringify({ command, measuredAt: new Date().toISOString(), inferenceCalls: 0, rows }, null, 2)); return; }
  const row = rows.find(r => r.zeroCostReady);
  if (!row) { console.log(JSON.stringify({ command, status: rows.some(r => !r.credentialAccess) ? 'NOT_RUN_LOCAL_CREDENTIAL_REQUIRED' : 'NOT_RUN_ZERO_COST_NOT_GUARANTEED', inferenceCalls: 0, monetaryCostUsd: 0, rows }, null, 2)); return; }
  const { db, sqlite } = openDatabase(config.dbPath);
  try {
    const router = new ModelRouter(config.model, { credentials: broker, state: new StateStore(db) });
    const candidate: ModelCandidate = {
      economics: row.economics,
      inferenceProfile: 'smoke:max-output-512',
      metadataQuality: 1,
      local: providerId === 'ollama',
      externalQuotaConsumption: providerId !== 'ollama',
      costClass: ['PROVIDER_FREE_PLAN', 'PROVIDER_BILLING_API'].includes(row.costEvidenceSource) ? 'FREE_TIER_ELIGIBLE' : row.costClass,
      structuredOutput: 'unknown',
      computeTier: providerId === 'ollama' ? 'LOCAL_EMERGENCY' : 'OTHER_FREE_CLOUD',
      eligible: true,
      provider: providerId!,
      model: requestedModel!,
      capabilities: ['text'],
      contextWindow: 'unknown',
      toolCalling: 'unknown',
      predictedQuality: 1,
      historicalSuccess: 0,
      reliability: 1,
      monetaryCostUsd: 0,
      shadowCostUsd: 0,
      latencyPenalty: 0,
      failureRisk: 0,
      effectiveResourceCost: 0,
      utility: 1,
      quota: { provider: providerId!, model: requestedModel!, requestsPerMinute: 'unknown', requestsPerDay: 'unknown', tokensPerMinute: 'unknown', tokensPerDay: 'unknown', requestQuotaTotal: 'unknown', requestQuotaRemaining: 'unknown', tokenQuotaTotal: 'unknown', tokenQuotaRemaining: 'unknown', resetAt: 'unknown', health: 'unknown', lastUpdatedAt: 'unknown' },
      performance: { provider: providerId!, model: requestedModel!, taskType: 'chat', samples: 0, successes: 0, failures: 0, successRate: 0, avgEvaluationScore: 0, avgLatencyMs: 0, avgMonetaryCostUsd: 0, avgShadowCostUsd: 0, avgAttempts: 0 },
      benchmarkCapability: null,
      capabilityEvidence: { bibScore: null, bibSamples: 0, realScore: null, realSamples: 0, predictedScore: 1, source: 'metadata' },
      explanation: { positives: [], penalties: [], constraints: ['explicit-zero-cost-operational-smoke'] }
    };
    const started = Date.now();
    let response;
    let terminalAttempt: InferenceAttempt | undefined;
    try {
      response = (await runCandidates({ taskId: `zero-cost-smoke:${randomUUID()}`, phase: 'DIRECT_RESPONSE', candidates: [candidate], messages: [{ role: 'user', content: 'Reply briefly with OK.' }], maxCandidates: 1, remoteAttemptBudget: 1, localFallbackBudget: 1, maxDurationMs: 60_000, maxMonetaryCostUsd: 0, maxShadowCostUsd: Number.POSITIVE_INFINITY, canAttempt: c => router.canAttempt(c), complete: (messages, c) => router.completeForZeroCostSmoke(messages, c), validate: result => result, record: async attempt => { if (attempt.status === 'FAILED') terminalAttempt = attempt; await router.recordAttempt(attempt); } })).response;
    }
    catch (error) {
      const failure = terminalAttempt?.failureClass ? new InferenceError(terminalAttempt.error ?? 'Inference failed.', terminalAttempt.failureClass, terminalAttempt.httpStatus, terminalAttempt.responseBody, terminalAttempt.retryAfterAt, terminalAttempt.failureScope, terminalAttempt.upstreamHttpStatus, terminalAttempt.monetaryCostUsd > 0 ? terminalAttempt.monetaryCostUsd : undefined) : classifyFailure(error);
      const exhausted = failure.failureClass === 'RATE_LIMITED' && /daily|quota|limit_rpd/i.test(failure.responseBody ?? '');
      const blockedBeforeCall = !failure.httpStatus && ['ECONOMIC_POLICY_BLOCKED', 'NEEDS_CAPABILITY', 'AUTH_REQUIRED'].includes(failure.failureClass);
      console.log(JSON.stringify({ command, provider: providerId, model: requestedModel, status: 'FAIL', failureClass: failure.failureClass, failureScope: failure.failureScope ?? 'UNKNOWN', httpStatus: failure.httpStatus, upstreamHttpStatus: failure.upstreamHttpStatus, inferenceCalls: blockedBeforeCall ? 0 : 1, latencyMs: Date.now() - started, monetaryCostUsd: failure.reportedMonetaryCostUsd ?? (failure.failureClass === 'ECONOMIC_POLICY_BLOCKED' && failure.httpStatus ? 'UNKNOWN' : 0), freeQuota: exhausted ? 'EXHAUSTED' : row.freeQuota, resetAt: failure.retryAfterAt ?? 'UNKNOWN', costEvidenceSource: row.costEvidenceSource, diagnostic: failure.responseBody ? failure.responseBody.slice(0, 800) : undefined, verifierQualified: false }, null, 2));
      process.exitCode = 1; return;
    }
    const physicalIdentity = physicalModelIdentity(response.attribution?.reportedModel ?? '');
    const requestedIdentity = physicalModelIdentity(requestedModel!);
    const identityAccepted = requestedModel === 'openrouter/free' ? Boolean(physicalIdentity) : Boolean(physicalIdentity && physicalIdentity === requestedIdentity);
    const usableText = response.content.trim().length > 0;
    console.log(JSON.stringify({ command, provider: providerId, model: requestedModel, status: usableText && identityAccepted ? 'PASS_OPERATIONAL_ONLY' : 'FAIL_RESPONSE_OR_IDENTITY', inferenceCalls: 1, maxOutputTokens: 512, latencyMs: Date.now() - started, monetaryCostUsd: response.estimatedCostUsd, physicalModel: response.attribution?.reportedModel, upstreamProvider: response.attribution?.upstreamProvider, upstreamAttemptCount: response.attribution?.upstreamAttemptCount, contentPreview: response.content.trim().slice(0, 120), quota: candidate.quota, economics: candidate.economics, verifierQualified: false, capabilityQualified: false }, null, 2));
  } finally { sqlite.close(); }
}
main().catch(() => { console.error(JSON.stringify({ status: 'STOPPED', error: 'Zero-cost qualification stopped; consult metadata diagnostics. No retry performed.' })); process.exitCode = 1; });
