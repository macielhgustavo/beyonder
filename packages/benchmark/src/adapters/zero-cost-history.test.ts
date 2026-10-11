import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { it, expect } from 'vitest';
import { AutopilotStateStore, getProvider } from '@beyonder/compute';
import { ModelRouter, loadConfig } from '@beyonder/runtime';
import { BenchmarkStore } from '../persistence/store.js';
import { BibModelCapabilitySource } from './model-capability-source.js';
it.each(['PAID','UNKNOWN_COST','FREE_QUOTA_EXHAUSTED'] as const)('economic rejection %s preserves exact durable BIB observations and capability',async reason=>{
 const dir=await mkdtemp(join(tmpdir(),'economic-bib-'));try{
  const path=join(dir,'bib.sqlite'),store=new BenchmarkStore(path),now=new Date();
  store.saveResults([{id:'isolated-regression-history',caseId:'isolated-case',provider:'kilo-gateway',model:'vendor/model:free',category:'coding',status:'PASS',quality:0.9,success:true,monetaryCost:0,attempts:1,timestamp:now}]);
  const before=store.listResults(),source=new BibModelCapabilitySource(store);const request={provider:'kilo-gateway',model:'vendor/model:free',taskType:'coding' as const};expect((await source.getCapability(request))?.score).toBe(0.9);
  const statePath=join(dir,'providers.json');await new AutopilotStateStore(statePath).update(getProvider('kilo-gateway')!,'READY',{validation:{status:'validated',models:[request.model],rateLimitHeaders:reason==='FREE_QUOTA_EXHAUSTED'?{'x-ratelimit-remaining-requests':'0'}:{},modelMetadata:[{id:request.model,role:'instruct',capabilities:['CHAT','CODING'],costClass:reason==='FREE_QUOTA_EXHAUSTED'?'FREE_TIER_ELIGIBLE':reason,costEvidence:{source:'live-catalog',observedAt:now.toISOString(),zeroPrice:true,explicitFreeRoute:true}}]}});
  const route=await new ModelRouter(loadConfig({BEYONDER_MODEL_PROVIDER:'auto',BEYONDER_PROVIDER_STATE_PATH:statePath,OLLAMA_BASE_URL:'http://127.0.0.1:1'}).model,{capabilitySource:source}).route({id:'isolated-gate',input:'Write a function',type:'coding',complexity:0.4,risk:0,estimatedTokens:100,requirements:{coding:true}},'normal');expect(route.candidates).toHaveLength(0);expect(route.rejectedCandidates?.find(c=>c.model===request.model)?.economics?.classification).toBe(reason);
  expect((await source.getCapability(request))?.score).toBe(0.9);const reopened=new BenchmarkStore(path);try {expect(reopened.listResults()).toEqual(before);}finally{reopened.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
