import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { it, expect } from 'vitest';
const exec = promisify(execFile);
it.each([false,true])('operator smoke has zero external network access in controlled mode (qualified=%s)',async qualified=>{
 const dir=await mkdtemp(join(tmpdir(),'zero-cost-cli-'));try{
  const provider=qualified?'kilo-gateway':'gemini',model=qualified?'vendor/isolated-model:free':'gemini-2.5-flash',now=new Date().toISOString(),state=join(dir,'state.json'),preload=join(dir,'preload.mjs');
  await writeFile(state,JSON.stringify({version:1,updatedAt:now,providers:{[provider]:{providerId:provider,state:'READY',classification:qualified?'KEYLESS':'FULL_AUTO',attempts:1,lastUpdatedAt:now,validation:{status:'validated',models:[model],modelMetadata:[{id:model,role:'instruct',capabilities:['CHAT'],costClass:'FREE_TIER_ELIGIBLE',...(qualified?{costEvidence:{source:'live-catalog',observedAt:now,zeroPrice:true,explicitFreeRoute:true}}:{})}]}}}}));
  await writeFile(preload,`let attempts=0;globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/api/tags'))return Response.json({models:[]});if(!${qualified}||!String(url).endsWith('/chat/completions')||++attempts>1)throw Error('Network prohibited in this regression');const body=JSON.parse(init.body);if(body.max_tokens!==512||body.model!==${JSON.stringify(model)}||body.provider?.max_price?.prompt!==0)throw Error('Invalid bounded zero-cost request');return Response.json({model:'vendor/isolated-model',choices:[{message:{content:'OK'}}],usage:{cost:0}});};`);
  const secret='opaque-test-only-credential';const {stdout}=await exec(process.execPath,['--import','tsx','--import',preload,'scripts/zero-cost-cli.ts','smoke','--provider',provider,'--model',model],{cwd:resolve('.'),env:{...process.env,DOTENV_CONFIG_PATH:join(dir,'missing.env'),BEYONDER_EXTERNAL_BILLING_ENABLED:'',BEYONDER_DB_PATH:join(dir,'runtime.sqlite'),BEYONDER_PROVIDER_STATE_PATH:state,BEYONDER_REPO_ROOT:dir,BEYONDER_CREDENTIAL_VAULT_PATH:join(dir,'missing-vault.json'),BEYONDER_CREDENTIAL_MANIFEST_PATH:join(dir,'missing-manifest.json'),BEYONDER_ZERO_COST_EVIDENCE_PATH:join(dir,'missing-economic-proof.json'),GEMINI_API_KEY:secret,GOOGLE_API_KEY:secret},timeout:20_000});
  expect(stdout).not.toContain(secret);const result=JSON.parse(stdout);expect(result.monetaryCostUsd).toBe(0);expect(result.inferenceCalls).toBe(qualified?1:0);expect(result.status).toBe(qualified?'PASS_OPERATIONAL_ONLY':'NOT_RUN_ZERO_COST_NOT_GUARANTEED');if(qualified){expect(result.maxOutputTokens).toBe(512);expect(result.verifierQualified).toBe(false);expect(result.capabilityQualified).toBe(false);}
 }finally{await rm(dir,{recursive:true,force:true});}
}, 15_000);

it('persists a scoped real-attempt quota rejection and refuses a second operator smoke after process restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zero-cost-quota-'));try{
  const provider='kilo-gateway',model='vendor/isolated-quota:free',now=new Date().toISOString(),state=join(dir,'state.json'),preload=join(dir,'preload.mjs'),dbPath=join(dir,'runtime.sqlite');
  await writeFile(state,JSON.stringify({version:1,updatedAt:now,providers:{[provider]:{providerId:provider,state:'READY',classification:'KEYLESS',attempts:1,lastUpdatedAt:now,validation:{status:'validated',models:[model],modelMetadata:[{id:model,role:'instruct',capabilities:['CHAT'],costClass:'FREE_TIER_ELIGIBLE',costEvidence:{source:'live-catalog',observedAt:now,zeroPrice:true,explicitFreeRoute:true}}]}}}}));
  const reset=Math.floor(Date.now()/1000)+3600;
  await writeFile(preload,`globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/api/tags'))return Response.json({models:[]});if(process.env.PROHIBIT_POST==='1'||!String(url).endsWith('/chat/completions'))throw Error('Forbidden network');return Response.json({error:{message:'daily quota limit_rpd/vendor/model/shared-pool',metadata:{limit_source:'openrouter_shared_capacity',headers:{'x-ratelimit-reset':${JSON.stringify(String(reset))}}}}},{status:429});};`);
  const env={...process.env,DOTENV_CONFIG_PATH:join(dir,'missing.env'),BEYONDER_EXTERNAL_BILLING_ENABLED:'',BEYONDER_DB_PATH:dbPath,BEYONDER_PROVIDER_STATE_PATH:state,BEYONDER_CREDENTIAL_VAULT_PATH:join(dir,'none'),BEYONDER_CREDENTIAL_MANIFEST_PATH:join(dir,'none-manifest'),BEYONDER_ZERO_COST_EVIDENCE_PATH:join(dir,'none-evidence')};
  const argv=['--import','tsx','--import',preload,'scripts/zero-cost-cli.ts','smoke','--provider',provider,'--model',model];
  let first:Record<string,unknown>={};try{await exec(process.execPath,argv,{cwd:resolve('.'),env,timeout:20_000});}catch(error){first=JSON.parse((error as {stdout:string}).stdout);}
  expect(first).toMatchObject({status:'FAIL',failureClass:'RATE_LIMITED',failureScope:'model',httpStatus:429,inferenceCalls:1,freeQuota:'EXHAUSTED',monetaryCostUsd:0});
  const {stdout}=await exec(process.execPath,argv,{cwd:resolve('.'),env:{...env,PROHIBIT_POST:'1'},timeout:20_000});expect(JSON.parse(stdout)).toMatchObject({status:'NOT_RUN_ROUTING_CONSTRAINT',inferenceCalls:0});
  const {openDatabase,StateStore}=await import('@beyonder/runtime');const opened=openDatabase(dbPath);try{const stateStore=new StateStore(opened.db);expect(await stateStore.get(`provider-health:${provider}`,{})).not.toHaveProperty('cooldown');expect(await stateStore.get(`model-health:${provider}:${model}`,{})).toHaveProperty('cooldown.scope','model');}finally{opened.sqlite.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
}, 15_000);
