import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutopilotStateStore, getProvider } from '@beyonder/compute';
import { AdaptiveModelSelector } from './adaptive-selector.js';
import { ModelRouter } from './model-router.js';
import { loadConfig } from '../config/env.js';
import { runCandidates } from './inference.js';
import { independentPhysicalModels, physicalModelIdentity } from './model-identity.js';
import type { ModelCandidate } from './adaptive-types.js';
import { fixtureZeroCost } from './testing/zero-cost-fixture.js';
afterEach(()=>vi.restoreAllMocks());
async function state(costClass: 'PAID' | 'UNKNOWN_COST' | 'FREE_TIER_ELIGIBLE', priced = false) {
 const dir = await mkdtemp(join(tmpdir(),'zero-cost-router-')), path = join(dir,'providers.json'); const store=new AutopilotStateStore(path);
 await store.update(getProvider('kilo-gateway')!,'READY',{validation:{status:'validated',models:['vendor/current:free'],modelMetadata:[{id:'vendor/current:free',capabilities:['CHAT'],role:'instruct',costClass,...(priced?{costEvidence:{source:'live-catalog' as const,observedAt:new Date().toISOString(),zeroPrice:true,explicitFreeRoute:true}}:{})}]}});return {store,path};
}
const task={id:'economic-gate',input:'Answer a short static question',type:'chat' as const,complexity:0.1,risk:0,estimatedTokens:30,requirements:{directResponse:true}};
describe('P1-D economic hard constraints',()=>{
 it.each(['PAID','UNKNOWN_COST','FREE_TIER_ELIGIBLE'] as const)('READY/keyless catalogue %s cannot fabricate zero cost',async costClass=>{
  const {store,path}=await state(costClass); const before=await store.read();const route=await new AdaptiveModelSelector(path).route(task,'normal');expect(route.candidates).toEqual([]);expect(route.rejectedCandidates?.some(c=>c.model==='vendor/current:free'&&c.economics?.monetaryCost.state==='UNKNOWN')).toBe(true);expect(await store.read()).toEqual(before);
 });
 it('accepts fresh priced explicit free route; preserves history on economic rejection',async()=>{
  const {store,path}=await state('FREE_TIER_ELIGIBLE',true);const before=await store.read();const route=await new AdaptiveModelSelector(path).route(task,'normal');expect(route.selected?.model).toBe('vendor/current:free');expect(route.selected?.monetaryCostUsd).toBe(0);expect(route.selected?.economics?.zeroCostExecutionGuaranteed).toBe(true);expect(await store.read()).toEqual(before);
 });
 it.each(['PAID','UNKNOWN_COST'] as const)('direct candidate completion %s never POSTs even with fabricated cost=0',async costClass=>{
  const {path}=await state(costClass);const config=loadConfig({BEYONDER_MODEL_PROVIDER:'auto',BEYONDER_PROVIDER_STATE_PATH:path});const fetch=vi.spyOn(globalThis,'fetch');await expect(new ModelRouter(config.model).completeForPlanningCandidate([],{provider:'kilo-gateway',model:'vendor/current:free',monetaryCostUsd:0} as ModelCandidate)).rejects.toMatchObject({failureClass:'ECONOMIC_POLICY_BLOCKED'});expect(fetch).not.toHaveBeenCalled();
 });
 it('direct generic endpoint cannot bypass UNKNOWN_COST even with a valid-looking credential',async()=>{const fetch=vi.spyOn(globalThis,'fetch');const router=new ModelRouter(loadConfig({BEYONDER_MODEL_PROVIDER:'openai-compatible',OPENAI_COMPAT_BASE_URL:'https://example.test/v1',OPENAI_COMPAT_API_KEY:'test-only-secret'}).model);await expect(router.complete([])).rejects.toMatchObject({failureClass:'ECONOMIC_POLICY_BLOCKED'});expect(fetch).not.toHaveBeenCalled();});
 it('runCandidates rejects a proofless zero and never invokes complete',async()=>{const complete=vi.fn();await expect(runCandidates({taskId:'t',phase:'DIRECT_RESPONSE',candidates:[{provider:'p',model:'m',monetaryCostUsd:0,shadowCostUsd:0} as ModelCandidate],messages:[],maxMonetaryCostUsd:0,maxShadowCostUsd:1,maxDurationMs:100,complete,validate:r=>r})).rejects.toMatchObject({failureClass:'ECONOMIC_POLICY_BLOCKED'});expect(complete).not.toHaveBeenCalled();});
 it('even a positive authorized budget never permits paid or billed responses/fallback',async()=>{const complete=vi.fn().mockResolvedValue({provider:'p',model:'m',estimatedCostUsd:0.01,content:'OK'});await expect(runCandidates({taskId:'t',phase:'DIRECT_RESPONSE',candidates:[{provider:'p',model:'m',monetaryCostUsd:0,shadowCostUsd:0,economics:fixtureZeroCost('p','m')},{provider:'q',model:'n',monetaryCostUsd:0,shadowCostUsd:0,economics:fixtureZeroCost('q','n')}] as ModelCandidate[],messages:[],maxMonetaryCostUsd:99,maxShadowCostUsd:1,maxDurationMs:100,complete,validate:r=>r})).rejects.toMatchObject({failureClass:'ECONOMIC_POLICY_BLOCKED'});expect(complete).toHaveBeenCalledOnce();});
 it('same physical model through Kilo/OpenRouter never gives independence',()=>{expect(independentPhysicalModels('thinkingmachines/inkling-small:free','inkling-small-free')).toBe(false);expect(independentPhysicalModels('cohere/north-mini-code:free','north-mini-code')).toBe(false);});
 it.each(['kilo-auto/free','openrouter/free','openrouter/auto','stealth/glyph-cluster'])('dynamic alias %s cannot supply verifier identity',model=>{expect(physicalModelIdentity(model)).toBe('');expect(independentPhysicalModels(model,'physical-model')).toBe(false);});
});

it.each([null, '', false, -1, 'not-a-price', 0.01])('reported ambiguous/charged usage %s never becomes zero or enables another attempt', async reported => {
 const {path}=await state('FREE_TIER_ELIGIBLE',true);const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({model:'vendor/current',choices:[{message:{content:'OK'}}],usage:{cost:reported}})));
 const router=new ModelRouter(loadConfig({BEYONDER_MODEL_PROVIDER:'auto',BEYONDER_PROVIDER_STATE_PATH:path}).model);
 await expect(router.completeForPlanningCandidate([],{provider:'kilo-gateway',model:'vendor/current:free'} as ModelCandidate)).rejects.toMatchObject({failureClass:'ECONOMIC_POLICY_BLOCKED'});
 expect(await router.canAttempt({provider:'kilo-gateway',model:'vendor/current:free'})).toBe(false);expect(fetch).toHaveBeenCalledOnce();
});
it('price/catalog drift between routing and execution blocks before POST without erasing capability metadata',async()=>{
 const {store,path}=await state('FREE_TIER_ELIGIBLE',true);const config=loadConfig({BEYONDER_MODEL_PROVIDER:'auto',BEYONDER_PROVIDER_STATE_PATH:path});const route=await new AdaptiveModelSelector(path).route(task,'normal');expect(route.selected).toBeDefined();
 const changed=await store.read();changed.providers['kilo-gateway'].validation!.modelMetadata![0]!.costClass='PAID';await store.write(changed);const fetch=vi.spyOn(globalThis,'fetch');await expect(new ModelRouter(config.model).completeForPlanningCandidate([],route.selected!)).rejects.toMatchObject({failureClass:'ECONOMIC_POLICY_BLOCKED'});expect(fetch).not.toHaveBeenCalled();expect((await store.read()).providers['kilo-gateway'].validation!.modelMetadata![0]!.capabilities).toEqual(['CHAT']);
});
it('quota drift between routing and execution blocks before POST',async()=>{
 const {store,path}=await state('FREE_TIER_ELIGIBLE',true);const route=await new AdaptiveModelSelector(path).route(task,'normal');const updated=await store.read();updated.providers['kilo-gateway'].validation!.rateLimitHeaders={'x-ratelimit-remaining-requests':'0'};await store.write(updated);const fetch=vi.spyOn(globalThis,'fetch');const router=new ModelRouter(loadConfig({BEYONDER_MODEL_PROVIDER:'auto',BEYONDER_PROVIDER_STATE_PATH:path}).model);await expect(router.completeForPlanningCandidate([],route.selected!)).rejects.toMatchObject({failureClass:'ECONOMIC_POLICY_BLOCKED'});expect(fetch).not.toHaveBeenCalled();
});
it('reported charge in a failed adapter remains in the audit attempt and cannot be recorded as zero',async()=>{
 const {path}=await state('FREE_TIER_ELIGIBLE',true),route=await new AdaptiveModelSelector(path).route(task,'normal');vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({model:'vendor/current',choices:[{message:{content:'OK'}}],usage:{cost:0.03}})));
 const router=new ModelRouter(loadConfig({BEYONDER_MODEL_PROVIDER:'auto',BEYONDER_PROVIDER_STATE_PATH:path}).model);const record=vi.fn();await expect(runCandidates({taskId:'isolated-billing-anomaly',phase:'DIRECT_RESPONSE',candidates:route.candidates,messages:[],maxMonetaryCostUsd:0,maxShadowCostUsd:1,maxDurationMs:1000,complete:(messages,candidate)=>router.completeForPlanningCandidate(messages,candidate),validate:r=>r,record})).rejects.toMatchObject({failureClass:'ECONOMIC_POLICY_BLOCKED',reportedMonetaryCostUsd:0.03});expect(record.mock.calls.at(-1)?.[0]).toMatchObject({status:'FAILED',monetaryCostUsd:0.03});
});
