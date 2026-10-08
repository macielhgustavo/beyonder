import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from '../app/api/control/command/route';
const secret='opaque-secret-with-no-known-prefix';
afterEach(()=>vi.unstubAllEnvs());
function request(body:string){return new NextRequest('http://127.0.0.1:4187/api/control/command',{method:'POST',headers:{host:'127.0.0.1:4187',origin:'http://127.0.0.1:4187','content-type':'application/json'},body});}
it.each([secret,JSON.stringify({type:'recordSettlement',workRunId:'test',amount:1,currency:secret,source:'test',externalReference:'test'})])('API validation never echoes opaque secret values or JSON parser snippets',async body=>{
 const response=await POST(request(body));expect(response.status).toBe(400);const payload=await response.text();expect(payload).not.toContain(secret.slice(0,10));expect(payload).not.toContain(secret);
});

it('setSecret never returns malformed vault content or changes it on failure',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'credential-api-'));mkdirSync(join(dir,'.providers-vault'));const vault=join(dir,'.providers-vault/vault.json');writeFileSync(vault,secret);vi.stubEnv('BEYONDER_REPO_ROOT',dir);
 try {const response=await POST(request(JSON.stringify({type:'setSecret',providerId:'groq',envVar:'GROQ_API_KEY',value:secret,vaultPassword:'test-only-master-password'})));expect(response.status).toBe(400);const payload=await response.text();expect(payload).not.toContain(secret.slice(0,10));expect(payload).not.toContain('test-only-master-password');expect(JSON.parse(payload).error).toBe('CREDENTIAL_DECRYPTION_FAILED');expect(readFileSync(vault,'utf8')).toBe(secret);} finally {rmSync(dir,{recursive:true,force:true});}
});
