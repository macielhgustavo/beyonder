import { expect, it } from 'vitest';
import { redact, fingerprint } from './redaction.js';
it('redacts nested opaque credentials, variants and bearer values without partial fingerprints',()=>{
 const secret='opaque-test-value';const value={api_key:secret,apiKey:secret,apikey:secret,token:secret,secret,authorization:secret,bearer:secret,private_key:secret,credential:secret,credentials:secret,providerApiKey:secret,nested:[{accessToken:secret}],safe:'public'};
 expect(redact(value)).not.toContain(secret);expect(redact(value)).toContain('public');expect(redact(`Bearer ${secret}`)).not.toContain(secret);expect(fingerprint(secret)).toBe('[REDACTED]');
});
