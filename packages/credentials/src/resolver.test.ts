import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialResolver, CredentialError } from './resolver.js';
import { Vault } from './vault.js';
const defs = [{ id: 'groq', authType: 'bearer', credentialEnvVars: ['GROQ_API_KEY'] }, { id: 'cloudflare-workers-ai', authType: 'account-id-and-token', credentialEnvVars: ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN'] }, { id: 'kilo-gateway', authType: 'keyless', credentialEnvVars: [] }];
async function setup() { const dir = await mkdtemp(join(tmpdir(),'beyonder-credentials-')); return { dir, vault: new Vault(join(dir,'vault.json')), manifestPath: join(dir,'manifest.json'), env: {} }; }
const secret = 'opaque-secret-with-no-known-prefix'; const password = 'test-only-master-password';
describe('portable credential boundary',()=>{
 it('resolves logical identity from explicit session ahead of vault/env and never serializes material',async()=>{
  const options=await setup(); await options.vault.set('groq','GROQ_API_KEY','vault-only',password);
  const events: unknown[]=[];const resolver=new CredentialResolver(defs,{}, {...options,env:{GROQ_API_KEY:'env-only'}, masterKey:async()=>password,session:new Map([['groq',{values:{GROQ_API_KEY:secret},scopes:['inference']}]]),onEvent:(e,d)=>{events.push([e,d]);}});
  const result=await resolver.resolve('credential://provider/groq');expect(result.apiKey()).toBe(secret);expect(result.descriptor.source).toBe('SESSION');expect(JSON.stringify([result,resolver,events])).not.toContain(secret);expect(result.redact(`echo:${secret}`)).toBe('echo:[REDACTED]');
 });
 it('decrypts the same portable existing vault in two environment configurations',async()=>{
  const options=await setup();await options.vault.set('groq','GROQ_API_KEY',secret,password);
  const a=await new CredentialResolver(defs,{}, {...options,masterKey:async()=>password}).resolve('groq');
  const b=await new CredentialResolver(defs,{}, {...options,env:{BEYONDER_CREDENTIAL_MASTER_KEY:password}}).resolve('groq');
  expect(a.apiKey()).toBe(b.apiKey());expect(a.descriptor.source).toBe('BEYONDER_VAULT');expect(await readFile(join(options.dir,'vault.json'),'utf8')).not.toContain(secret);
 });
 it('reports configured locked vault rather than missing and preserves metadata',async()=>{
  const options=await setup();await options.vault.set('groq','GROQ_API_KEY',secret,password);
  const resolver=new CredentialResolver(defs,{},options);await resolver.rememberConfigured('groq','BEYONDER_VAULT');
  expect((await resolver.resolve('groq')).descriptor).toMatchObject({configured:true,present:true,accessible:false,valid:'UNKNOWN',status:'VAULT_LOCKED'});
  expect(await readFile(options.manifestPath,'utf8')).not.toContain(secret);
 });
 it('distinguishes absent vault entry knowledge from configured metadata',async()=>{
  const options=await setup();await options.vault.set('groq','GROQ_API_KEY',secret,password);
  expect((await new CredentialResolver(defs,{},options).resolve('groq')).descriptor).toMatchObject({configured:'UNKNOWN',present:'UNKNOWN',status:'VAULT_LOCKED'});
 });
 it('keeps env compatible; invalid key is still present and accessible but invalid',async()=>{
  const resolver=new CredentialResolver(defs,{}, {...await setup(),env:{GROQ_API_KEY:secret}});const result=await resolver.resolve('groq');expect(result.descriptor.source).toBe('ENV_COMPATIBILITY');await resolver.markValidation(result,false);expect(await resolver.describe('groq')).toMatchObject({present:true,accessible:true,valid:false,status:'CREDENTIAL_INVALID'});expect(()=>result.require()).toThrow(CredentialError);
 });
 it('reports genuinely unconfigured credentials as absent',async()=>{expect((await new CredentialResolver(defs,{},await setup()).resolve('groq')).descriptor).toMatchObject({present:false,configured:false,accessible:false,status:'CREDENTIAL_NOT_CONFIGURED'});});
 it('represents local-only configured metadata without inventing accessibility or validity',async()=>{expect((await new CredentialResolver(defs,{}, {...await setup(),manifest:{groq:{configured:true,present:true,source:'LOCAL_ONLY'}}}).resolve('groq')).descriptor).toMatchObject({configured:true,accessible:false,valid:'UNKNOWN',status:'CREDENTIAL_SOURCE_UNAVAILABLE'});});
 it('uses supported backend adapters in order and sanitizes throwing backend/key errors',async()=>{
  const options=await setup();const resolver=new CredentialResolver(defs,{}, {...options,backends:[{kind:'OS_KEYRING',resolve:async()=>({values:{GROQ_API_KEY:'keyring'},scopes:['inference']})},{kind:'ENVIRONMENT_BACKEND',resolve:async()=>({values:{GROQ_API_KEY:secret},scopes:['inference']})}]});expect((await resolver.resolve('groq')).descriptor.source).toBe('ENVIRONMENT_BACKEND');
  const unavailable=new CredentialResolver(defs,{}, {...options,backends:[{kind:'ENVIRONMENT_BACKEND',resolve:async()=>{throw Error(secret);}}]});expect(JSON.stringify(await unavailable.resolve('groq'))).not.toContain(secret);
 });
 it('requires all Cloudflare parts from one source and refuses spend scope',async()=>{
  const resolver=new CredentialResolver(defs,{}, {...await setup(),env:{CLOUDFLARE_ACCOUNT_ID:'account',CLOUDFLARE_API_TOKEN:secret,GROQ_API_KEY:secret}});expect((await resolver.resolve('credential://provider/cloudflare')).descriptor.accessible).toBe(true);const denied=await resolver.resolve('groq','spend');expect(denied.descriptor.status).toBe('CREDENTIAL_SCOPE_INSUFFICIENT');expect(denied.apiKey()).toBeUndefined();
 });
 it('fails closed on wrong master key without exposing cryptographic errors',async()=>{
  const options=await setup();await options.vault.set('groq','GROQ_API_KEY',secret,password);const result=await new CredentialResolver(defs,{}, {...options,masterKey:async()=> 'incorrect-master-password'}).resolve('groq');expect(result.descriptor.status).toBe('CREDENTIAL_DECRYPTION_FAILED');expect(JSON.stringify(result)).not.toContain(secret);
 });
 it('imports env only when explicitly invoked, verifies encryption, and never changes env or overwrites a vault entry',async()=>{
  const options=await setup(),env={GROQ_API_KEY:secret};const resolver=new CredentialResolver(defs,{}, {...options,env});await resolver.importEnvironment('groq',password);expect(env.GROQ_API_KEY).toBe(secret);expect((await options.vault.read(password)).groq.GROQ_API_KEY).toBe(secret);expect(await readFile(join(options.dir,'vault.json'),'utf8')).not.toContain(secret);await expect(resolver.importEnvironment('groq',password)).rejects.toMatchObject({code:'CREDENTIAL_INVALID'});
 });
});

describe('credential metadata security',()=>{
 it('whitelists manifest fields and never trusts validation from portable metadata',async()=>{
  const options=await setup(); const resolver=new CredentialResolver(defs,{}, {...options,manifest:{groq:{configured:true,present:true,source:secret as never,lastValidated:secret,valid:true,apiKey:secret} as never}});
  const result=await resolver.resolve('groq');expect(result.descriptor.valid).toBe('UNKNOWN');expect(JSON.stringify(result)).not.toContain(secret);await resolver.rememberConfigured('cloudflare');expect(await readFile(options.manifestPath,'utf8')).not.toContain(secret);
 });
 it('can unlock after runtime master injection without restarting and compatibility access respects scopes',async()=>{
  const options=await setup();await options.vault.set('groq','GROQ_API_KEY',secret,password);const env: NodeJS.ProcessEnv={};const resolver=new CredentialResolver(defs,{}, {...options,env});expect((await resolver.resolve('groq')).descriptor.status).toBe('VAULT_LOCKED');env.BEYONDER_CREDENTIAL_MASTER_KEY=password;expect((await resolver.resolve('groq')).apiKey()).toBe(secret);
  const scoped=new CredentialResolver(defs,{}, {...options,env:{GROQ_API_KEY:'fallback'},session:new Map([['groq',{values:{GROQ_API_KEY:secret},scopes:['admin']}]] )});expect(scoped.getSecret('groq','GROQ_API_KEY')).toBeUndefined();expect((await scoped.resolve('groq')).descriptor.status).toBe('CREDENTIAL_SCOPE_INSUFFICIENT');
 });
});
