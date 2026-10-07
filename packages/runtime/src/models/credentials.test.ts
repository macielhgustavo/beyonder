import { expect, it, vi } from 'vitest';
import { ModelRouter } from './model-router.js';
import { loadConfig } from '../config/env.js';
import { CredentialBroker } from '@beyonder/compute';
it('compatibility endpoint configuration never serializes keys and resolves centrally',async()=>{
 const secret='opaque-explicit-config-material';const config=loadConfig({OPENAI_COMPAT_BASE_URL:'https://provider.example/v1',OPENAI_COMPAT_API_KEY:secret,BEYONDER_MODEL_PROVIDER:'openai-compatible'});
 expect(JSON.stringify(config)).not.toContain(secret);
 const broker=new CredentialBroker({}, {}, {session:new Map([['openai-compatible',{values:{OPENAI_COMPAT_API_KEY:secret},scopes:['inference']}]] )});
 const spy=vi.spyOn(broker,'resolve');vi.stubGlobal('fetch',vi.fn(async (_url,init)=>{expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${secret}`);return new Response(secret,{status:401});}));
 try {await expect(new ModelRouter(config.model,{credentials:broker}).complete([])).rejects.toThrow('HTTP 401');expect(spy).toHaveBeenCalledWith('openai-compatible');} finally {vi.unstubAllGlobals();}
});
