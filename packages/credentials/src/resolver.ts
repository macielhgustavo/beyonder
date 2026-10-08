import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Vault, type VaultData } from './vault.js';
import { CredentialError, type CredentialFailure } from './errors.js';
export { CredentialError } from './errors.js';
export type { CredentialFailure } from './errors.js';

export type Truth = boolean | 'UNKNOWN';
export type CredentialScope = 'inference' | 'read' | 'write' | 'spend' | 'sign' | 'trade' | 'withdraw' | 'admin';
export type CredentialSource = 'SESSION' | 'BEYONDER_VAULT' | 'ENVIRONMENT_BACKEND' | 'OS_KEYRING' | 'ENV_COMPATIBILITY' | 'LOCAL_ONLY' | 'NONE' | 'KEYLESS';
export interface CredentialDescriptor {
  identity: string; provider: string; expected: boolean; configured: Truth; present: Truth;
  accessible: boolean; valid: Truth; source: CredentialSource; scope: CredentialScope[];
  status: CredentialFailure | 'CREDENTIAL_ACCESSIBLE' | 'KEYLESS'; lastValidated: string | null;
}
export interface CredentialDefinition { id: string; authType: string; credentialEnvVars: string[]; }
export interface SecretBackend {
  kind: 'ENVIRONMENT_BACKEND' | 'OS_KEYRING';
  resolve(provider: string, scope: CredentialScope): Promise<{ values: Record<string, string>; scopes: CredentialScope[] } | null>;
}
export interface ResolverOptions {
  env?: NodeJS.ProcessEnv; vault?: Vault; manifestPath?: string;
  masterKey?: () => Promise<string | undefined>; session?: Map<string, { values: Record<string, string>; scopes: CredentialScope[] }>;
  backends?: SecretBackend[]; manifest?: Record<string, Partial<CredentialDescriptor>>;
  onEvent?: (event: string, details: CredentialDescriptor) => void | Promise<void>;
}
/** Only metadata serializes. Secret access is explicit and server-side. */
export class ResolvedCredential {
  #values: Record<string, string>;
  constructor(readonly descriptor: CredentialDescriptor, values: Record<string, string> = {}) { this.#values = values; }
  get(name: string): string | undefined { return this.#values[name]; }
  redact(value: string): string { for (const secret of Object.values(this.#values)) if (secret) value = value.replaceAll(secret, '[REDACTED]'); return value; }
  apiKey(): string | undefined { return Object.entries(this.#values).find(([name]) => !name.endsWith('ACCOUNT_ID'))?.[1]; }
  require(): this { if (!this.descriptor.accessible || this.descriptor.valid === false) throw new CredentialError(this.descriptor.status === 'CREDENTIAL_ACCESSIBLE' || this.descriptor.status === 'KEYLESS' ? 'CREDENTIAL_INVALID' : this.descriptor.status); return this; }
  toJSON() { return this.descriptor; }
}
const sessions = new Map<string, { values: Record<string, string>; scopes: CredentialScope[] }>();
/** Authorized explicit server/session injection; never exported in snapshots. */
export function injectSessionCredential(provider: string, values: Record<string, string>, scopes: CredentialScope[] = ['inference']) {
  sessions.set(provider, { values: { ...values }, scopes: [...scopes] });
}
export function clearSessionCredential(provider: string) { sessions.delete(provider); }

export class CredentialResolver {
  #definitions: CredentialDefinition[];
  #options: ResolverOptions;
  #unlocked: VaultData;
  #prepared = new Map<string, ResolvedCredential>();
  #validation = new Map<string, { valid: boolean; at: string; resolution: ResolvedCredential }>();
  #vaultRead?: Promise<{ data?: VaultData; failure?: CredentialFailure; exists: boolean }>;
  constructor(definitions: CredentialDefinition[], unlocked: VaultData = {}, options: ResolverOptions = {}) {
    this.#definitions = definitions; this.#unlocked = unlocked; this.#options = options;
  }
  get env() { return this.#options.env ?? process.env; }
  get vault() { return this.#options.vault ?? new Vault(this.env.BEYONDER_CREDENTIAL_VAULT_PATH ?? resolve(this.env.BEYONDER_REPO_ROOT ?? process.cwd(), '.providers-vault/vault.json')); }
  get manifestPath() { return this.#options.manifestPath ?? this.env.BEYONDER_CREDENTIAL_MANIFEST_PATH ?? resolve(this.env.BEYONDER_REPO_ROOT ?? process.cwd(), '.providers-vault/credential-manifest.json'); }
  private definition(id: string) {
    const canonical = id.replace(/^credential:\/\/provider\//, '') === 'cloudflare' ? 'cloudflare-workers-ai' : id.replace(/^credential:\/\/provider\//, '');
    const definition = this.#definitions.find(p => p.id === canonical);
    if (!definition) throw new CredentialError('CREDENTIAL_NOT_CONFIGURED');
    return definition;
  }
  private values(definition: CredentialDefinition, source?: Record<string, string | undefined>) {
    return Object.fromEntries(definition.credentialEnvVars.flatMap(name => source?.[name]?.trim() ? [[name, source[name]!]] : []));
  }
  private complete(definition: CredentialDefinition, values: Record<string, string>) {
    return definition.authType === 'keyless' || (definition.authType === 'account-id-and-token' ? definition.credentialEnvVars.every(name => Boolean(values[name])) : Object.keys(values).some(name => !name.endsWith('ACCOUNT_ID')));
  }
  private async readManifest(): Promise<Record<string, Partial<CredentialDescriptor>>> {
    try { const parsed = this.#options.manifest ?? JSON.parse(await readFile(this.manifestPath, 'utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const safe: Record<string, Partial<CredentialDescriptor>> = {};
      const sources: CredentialSource[] = ['SESSION','BEYONDER_VAULT','ENVIRONMENT_BACKEND','OS_KEYRING','ENV_COMPATIBILITY','LOCAL_ONLY','NONE','KEYLESS'];
      for (const provider of this.#definitions) {
        const entry = parsed[provider.id]; if (!entry || typeof entry !== 'object') continue;
        safe[provider.id] = { configured: entry.configured === true, present: entry.present === true, source: sources.includes(entry.source) ? entry.source : 'LOCAL_ONLY', lastValidated: typeof entry.lastValidated === 'string' && /^\d{4}-\d\d-\d\dT/.test(entry.lastValidated) && Number.isFinite(Date.parse(entry.lastValidated)) ? entry.lastValidated : null };
      }
      return safe; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new CredentialError('CREDENTIAL_SOURCE_UNAVAILABLE'); }
  }
  private readVault() {
    const reading = this.#vaultRead ??= (async () => {
      let exists: boolean;
      try { exists = await this.vault.exists(); } catch { return { exists: true, failure: 'CREDENTIAL_SOURCE_UNAVAILABLE' as const }; }
      if (!exists) return { exists: false };
      let key: string | undefined;
      try { key = this.#options.masterKey ? await this.#options.masterKey() : this.env.BEYONDER_CREDENTIAL_MASTER_KEY ?? this.env.PROVIDER_BOOTSTRAPPER_MASTER_PASSWORD; } catch { return { exists, failure: 'CREDENTIAL_SOURCE_UNAVAILABLE' as const }; }
      if (!key) return { exists, failure: 'VAULT_LOCKED' as const };
      try { return { exists, data: await this.vault.read(key) }; }
      catch { return { exists, failure: 'CREDENTIAL_DECRYPTION_FAILED' as const }; }
    })();
    void reading.then(result => { if (!result.data && this.#vaultRead === reading) this.#vaultRead = undefined; });
    return reading;
  }
  async resolve(id: string, scope: CredentialScope = 'inference'): Promise<ResolvedCredential> {
    const definition = this.definition(id), provider = definition.id;
    let history: Partial<CredentialDescriptor> | undefined;
    let metadataUnavailable = false;
    try { history = (await this.readManifest())[provider]; }
    catch { metadataUnavailable = true; } // Metadata failure cannot deny an independently accessible source.
    let descriptor: CredentialDescriptor = { identity: `credential://provider/${provider}`, provider, expected: definition.authType !== 'keyless', configured: metadataUnavailable ? 'UNKNOWN' : history?.configured === true, present: metadataUnavailable ? 'UNKNOWN' : history?.present === true ? true : false, accessible: false, valid: 'UNKNOWN', source: history?.source ?? 'NONE', scope: ['inference'], status: metadataUnavailable || history?.configured === true ? 'CREDENTIAL_SOURCE_UNAVAILABLE' : 'CREDENTIAL_NOT_CONFIGURED', lastValidated: typeof history?.lastValidated === 'string' ? history.lastValidated : null };
    const emit = async (event: string) => { try { await this.#options.onEvent?.(event, { ...descriptor }); } catch { /* Observability cannot expose backend exceptions or alter execution. */ } };
    await emit('credential.resolve.started');
    const selected = async (source: CredentialSource, values: Record<string, string>, scopes: CredentialScope[]) => {
      scopes = scopes.filter(s => ['inference','read','write','spend','sign','trade','withdraw','admin'].includes(s));
      descriptor = { ...descriptor, source, configured: true, present: true, accessible: scopes.includes(scope), scope: scopes, status: scopes.includes(scope) ? 'CREDENTIAL_ACCESSIBLE' : 'CREDENTIAL_SCOPE_INSUFFICIENT' };
      const previous = this.#validation.get(provider);
      if (previous && previous.resolution.descriptor.source === source && definition.credentialEnvVars.every(name => previous.resolution.get(name) === values[name])) { descriptor.valid = previous.valid; descriptor.lastValidated = previous.at; if (!previous.valid) descriptor.status = 'CREDENTIAL_INVALID'; }
      await emit(descriptor.accessible ? 'credential.resolve.source_selected' : 'credential.resolve.unavailable');
      return new ResolvedCredential(descriptor, descriptor.accessible ? values : {});
    };
    if (definition.authType === 'keyless') return new ResolvedCredential({ ...descriptor, configured: false, present: false, source: 'KEYLESS', accessible: scope === 'inference', status: scope === 'inference' ? 'KEYLESS' : 'CREDENTIAL_SCOPE_INSUFFICIENT' });
    const session = (this.#options.session ?? sessions).get(provider);
    if (session && this.complete(definition, this.values(definition, session.values))) return selected('SESSION', this.values(definition, session.values), session.scopes);
    const unlocked = this.values(definition, this.#unlocked[provider]);
    if (this.complete(definition, unlocked)) return selected('BEYONDER_VAULT', unlocked, ['inference']);
    const vault = await this.readVault();
    const vaultValues = this.values(definition, vault.data?.[provider]);
    if (this.complete(definition, vaultValues)) return selected('BEYONDER_VAULT', vaultValues, ['inference']);
    for (const backend of [...(this.#options.backends ?? [])].sort((a, b) => a.kind === b.kind ? 0 : a.kind === 'ENVIRONMENT_BACKEND' ? -1 : 1)) {
      try { const result = await backend.resolve(provider, scope); if (result && this.complete(definition, this.values(definition, result.values))) return selected(backend.kind, this.values(definition, result.values), result.scopes); }
      catch { descriptor = { ...descriptor, status: 'CREDENTIAL_SOURCE_UNAVAILABLE', source: backend.kind }; }
    }
    const envValues = this.values(definition, this.env);
    if (this.complete(definition, envValues)) return selected('ENV_COMPATIBILITY', envValues, ['inference']);
    if (Object.keys(envValues).length || Object.keys(vaultValues).length || Object.keys(unlocked).length) descriptor = { ...descriptor, configured: true, present: true, status: 'CREDENTIAL_SOURCE_UNAVAILABLE', source: Object.keys(envValues).length ? 'ENV_COMPATIBILITY' : 'BEYONDER_VAULT' };
    if (vault.failure && !Object.keys(envValues).length && !Object.keys(unlocked).length) descriptor = { ...descriptor, configured: history?.configured === true ? true : 'UNKNOWN', present: history?.present === true ? true : 'UNKNOWN', source: 'BEYONDER_VAULT', status: vault.failure };
    await emit('credential.resolve.unavailable');
    return new ResolvedCredential(descriptor);
  }
  async markValidation(resolution: ResolvedCredential, valid: boolean, code: CredentialFailure = 'CREDENTIAL_INVALID') {
    resolution.descriptor.valid = valid; resolution.descriptor.lastValidated = new Date().toISOString();
    if (!valid) resolution.descriptor.status = code;
    this.#validation.set(resolution.descriptor.provider, { valid, at: resolution.descriptor.lastValidated, resolution });
    try { await this.#options.onEvent?.(valid ? 'credential.validation.succeeded' : 'credential.validation.failed', resolution.descriptor); } catch { /* Metadata only. */ }
  }
  async validationStarted(resolution: ResolvedCredential) { try { await this.#options.onEvent?.('credential.validation.started', { ...resolution.descriptor }); } catch { /* Metadata only. */ } }
  async describe(id: string) { return (await this.resolve(id)).descriptor; }
  async rememberConfigured(id: string, source: CredentialSource = 'LOCAL_ONLY') {
    const definition = this.definition(id); const previous = await this.readManifest();
    const descriptor: CredentialDescriptor = { identity: `credential://provider/${definition.id}`, provider: definition.id, expected: definition.authType !== 'keyless', configured: true, present: true, accessible: false, valid: 'UNKNOWN', source, scope: ['inference'], status: 'CREDENTIAL_SOURCE_UNAVAILABLE', lastValidated: null };
    // Reconstruct each entry using only the explicit safe schema, never copy arbitrary fields.
    const safe: Record<string, CredentialDescriptor> = {};
    for (const d of this.#definitions) if (previous[d.id]?.configured === true) safe[d.id] = { ...descriptor, identity: `credential://provider/${d.id}`, provider: d.id, source: previous[d.id]?.source ?? 'LOCAL_ONLY', lastValidated: previous[d.id]?.lastValidated ?? null };
    safe[definition.id] = descriptor;
    await mkdir(dirname(this.manifestPath), { recursive: true, mode: 0o700 });
    const tmp = `${this.manifestPath}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify(safe, null, 2), { mode: 0o600 }); await rename(tmp, this.manifestPath);
  }
  private async readForImport(password: string): Promise<VaultData> {
    try { await this.vault.exists(); }
    catch { throw new CredentialError('CREDENTIAL_SOURCE_UNAVAILABLE'); }
    try { return await this.vault.read(password); }
    catch { throw new CredentialError('CREDENTIAL_DECRYPTION_FAILED'); }
  }
  /** Explicit opt-in import: never changes env and never invents provider validation. */
  async importEnvironment(id: string, password: string) {
    const definition = this.definition(id), values = this.values(definition, this.env);
    if (password.length < 12) throw new CredentialError('CREDENTIAL_INVALID');
    if (!this.complete(definition, values)) throw new CredentialError('CREDENTIAL_NOT_CONFIGURED');
    const data = await this.readForImport(password);
    if (data[definition.id] && Object.keys(data[definition.id]).length) throw new CredentialError('CREDENTIAL_INVALID'); // Do not silently replace existing secrets.
    data[definition.id] = values;
    try { await this.vault.write(password, data); }
    catch { throw new CredentialError('CREDENTIAL_SOURCE_UNAVAILABLE'); }
    const restored = await this.readForImport(password);
    if (definition.credentialEnvVars.some(name => restored[definition.id]?.[name] !== values[name])) throw new CredentialError('CREDENTIAL_DECRYPTION_FAILED');
    await this.rememberConfigured(definition.id, 'BEYONDER_VAULT'); this.#vaultRead = undefined;
    return { identity: `credential://provider/${definition.id}`, imported: true };
  }
  async prepare() { for (const provider of this.#definitions) { const result = await this.resolve(provider.id); if (result.descriptor.accessible && result.descriptor.valid !== false) this.#prepared.set(provider.id, result); else this.#prepared.delete(provider.id); } return this; }
  /** Compatibility lookup for callers that already have an unlocked vault. */
  getSecret(id: string, name: string): string | undefined {
    const definition = this.definition(id); if (!definition.credentialEnvVars.includes(name)) return undefined;
    const prepared = this.#prepared.get(definition.id); if (prepared) return prepared.get(name);
    const session = (this.#options.session ?? sessions).get(definition.id);
    if (session && this.complete(definition, this.values(definition, session.values))) return session.scopes.includes('inference') ? session.values[name] : undefined;
    const unlocked = this.values(definition, this.#unlocked[definition.id]);
    if (this.complete(definition, unlocked)) return unlocked[name];
    const env = this.values(definition, this.env);
    return this.complete(definition, env) ? env[name] : undefined;
  }
  getProviderSecrets(id: string) { const definition = this.definition(id); return definition.credentialEnvVars.flatMap(envVar => { const value = this.getSecret(id, envVar); if (!value) return []; const record = { providerId: definition.id, envVar, source: this.#prepared.get(definition.id)?.descriptor.source === 'BEYONDER_VAULT' || this.#unlocked[definition.id]?.[envVar] ? 'vault' as const : 'env' as const } as { providerId: string; envVar: string; source: 'env' | 'vault'; value: string }; Object.defineProperty(record, 'value', { value, enumerable: false }); return [record]; }); }
  hasProviderCredential(id: string) { return this.getProviderSecrets(id).length > 0; }
  redactedSummary() { return Object.fromEntries(this.#definitions.flatMap(d => { const records = this.getProviderSecrets(d.id); return records.length ? [[d.id, records.map(r => `${r.envVar}:${r.source}`)]] : []; })); }
  toJSON() { return { sources: this.redactedSummary() }; }
}
