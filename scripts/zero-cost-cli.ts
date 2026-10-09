import 'dotenv/config';
import { AutopilotStateStore, CredentialBroker, getProvider, validateProviderDetailed, zeroCostInventory } from '@beyonder/compute';
import { loadConfig, ModelRouter, physicalModelIdentity, classifyFailure, InferenceError, runCandidates, openDatabase, StateStore, type InferenceAttempt } from '@beyonder/runtime';
import { randomUUID } from 'node:crypto';

const command = process.argv[2];
const args = process.argv.slice(3);
function option(name: string) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
async function main() {
  if (!['inventory', 'smoke'].includes(command)) throw new Error('Use inventory or smoke.');
  const providerId = option('--provider'), requestedModel = option('--model');
  if (command === 'smoke' && (!providerId || !requestedModel)) throw new Error('Smoke requires explicit --provider and --model; one short call, no retries.');
  const config = loadConfig({ ...process.env, BEYONDER_MODEL_PROVIDER: 'auto' });
  const store = new AutopilotStateStore(config.model.providerStatePath);
  const broker = new CredentialBroker({}, process.env, { providerStatePath: config.model.providerStatePath });
  if (args.includes('--refresh-catalog')) {
    const provider = providerId && getProvider(providerId);
    if (!provider) throw new Error('Catalogue refresh requires an explicit supported --provider.');
    const report = await validateProviderDetailed({ ...provider, validation: { ...provider.validation, method: provider.authType === 'keyless' ? 'keyless-models' : provider.validation?.method ?? 'none', url: provider.validation?.url ?? `${provider.openAiCompatibleEndpoint}/models` } }, broker);
    if (report.status.validationStatus === 'validated') {
      await store.update(provider, 'READY', { validation: { status: 'validated', models: report.models, modelMetadata: report.modelMetadata, modelCount: report.modelCount, rateLimitHeaders: report.rateLimitHeaders, latencyMs: report.latencyMs } });
    } // A failed refresh never replaces observed catalogue/capability history.
  }
  const rows = (await zeroCostInventory(config.model.providerStatePath, broker)).filter(row => (!providerId || row.provider === providerId) && (!requestedModel || row.model === requestedModel));
  if (command === 'inventory') { console.log(JSON.stringify({ command, measuredAt: new Date().toISOString(), inferenceCalls: 0, rows }, null, 2)); return; }
  const row = rows.find(r => r.zeroCostReady);
  if (!row) { console.log(JSON.stringify({ command, status: rows.some(r => !r.credentialAccess) ? 'NOT_RUN_LOCAL_CREDENTIAL_REQUIRED' : 'NOT_RUN_ZERO_COST_NOT_GUARANTEED', inferenceCalls: 0, monetaryCostUsd: 0, rows }, null, 2)); return; }
  const { db, sqlite } = openDatabase(config.dbPath);
  try {
  const router = new ModelRouter(config.model, { credentials: broker, state: new StateStore(db) });
  const route = await router.route({ id: 'zero-cost-operational-smoke', input: 'Return exactly OK.', type: 'chat', complexity: 0.05, risk: 0, estimatedTokens: 32, requirements: { directResponse: true } }, 'normal');
  const candidate = route.candidates.find(c => c.provider === providerId && c.model === requestedModel);
  if (!candidate) { console.log(JSON.stringify({ command, status: 'NOT_RUN_ROUTING_CONSTRAINT', inferenceCalls: 0, monetaryCostUsd: 0, rejected: route.rejectedCandidates?.filter(c => c.provider === providerId && c.model === requestedModel) }, null, 2)); return; }
  const started = Date.now();
  let response;
  let terminalAttempt: InferenceAttempt | undefined;
  try {
    response = (await runCandidates({ taskId: `zero-cost-smoke:${randomUUID()}`, phase: 'DIRECT_RESPONSE', candidates: [candidate], messages: [{ role: 'user', content: 'Return exactly OK.' }], maxCandidates: 1, remoteAttemptBudget: 1, localFallbackBudget: 1, maxDurationMs: 60_000, maxMonetaryCostUsd: 0, maxShadowCostUsd: Number.POSITIVE_INFINITY, canAttempt: c => router.canAttempt(c), complete: (messages, c) => router.completeForZeroCostSmoke(messages, c), validate: result => result, record: async attempt => { if (attempt.status === 'FAILED') terminalAttempt = attempt; await router.recordAttempt(attempt); } })).response;
  }
  catch (error) {
    // The mission runner may summarize all failed providers as NEEDS_CAPABILITY;
    // an operational probe must retain the actual single upstream failure.
    const failure = terminalAttempt?.failureClass ? new InferenceError(terminalAttempt.error ?? 'Inference failed.', terminalAttempt.failureClass, terminalAttempt.httpStatus, terminalAttempt.responseBody, terminalAttempt.retryAfterAt, terminalAttempt.failureScope, terminalAttempt.upstreamHttpStatus, terminalAttempt.monetaryCostUsd > 0 ? terminalAttempt.monetaryCostUsd : undefined) : classifyFailure(error);
    const exhausted = failure.failureClass === 'RATE_LIMITED' && /daily|quota|limit_rpd/i.test(failure.responseBody ?? '');
    const blockedBeforeCall = !failure.httpStatus && ['ECONOMIC_POLICY_BLOCKED', 'NEEDS_CAPABILITY', 'AUTH_REQUIRED'].includes(failure.failureClass);
    console.log(JSON.stringify({ command, provider: providerId, model: requestedModel, status: 'FAIL', failureClass: failure.failureClass, failureScope: failure.failureScope ?? 'UNKNOWN', httpStatus: failure.httpStatus, upstreamHttpStatus: failure.upstreamHttpStatus, inferenceCalls: blockedBeforeCall ? 0 : 1, latencyMs: Date.now() - started, monetaryCostUsd: failure.reportedMonetaryCostUsd ?? (failure.failureClass === 'ECONOMIC_POLICY_BLOCKED' && failure.httpStatus ? 'UNKNOWN' : 0), freeQuota: exhausted ? 'EXHAUSTED' : row.freeQuota, resetAt: failure.retryAfterAt ?? 'UNKNOWN', costEvidenceSource: row.costEvidenceSource, verifierQualified: false }, null, 2));
    process.exitCode = 1; return;
  }
  const physicalIdentity = physicalModelIdentity(response.attribution?.reportedModel ?? '');
  const requestedIdentity = physicalModelIdentity(requestedModel!);
  const identityAccepted = requestedModel === 'openrouter/free' ? Boolean(physicalIdentity) : Boolean(physicalIdentity && physicalIdentity === requestedIdentity);
  console.log(JSON.stringify({ command, provider: providerId, model: requestedModel, status: response.content.trim() === 'OK' && identityAccepted ? 'PASS_OPERATIONAL_ONLY' : 'FAIL_RESPONSE_OR_IDENTITY', inferenceCalls: 1, maxOutputTokens: 32, latencyMs: Date.now() - started, monetaryCostUsd: response.estimatedCostUsd, physicalModel: response.attribution?.reportedModel, quota: candidate.quota, economics: candidate.economics, verifierQualified: false, capabilityQualified: false }, null, 2));
  } finally { sqlite.close(); }
}
main().catch(() => { console.error(JSON.stringify({ status: 'STOPPED', error: 'Zero-cost qualification stopped; consult metadata diagnostics. No retry performed.' })); process.exitCode = 1; });
