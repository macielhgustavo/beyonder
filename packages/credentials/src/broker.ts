import { providers } from './catalog.js';
import { CredentialResolver, type CredentialDefinition, type ResolverOptions } from './resolver.js';
import type { VaultData } from './vault.js';
export class CredentialBroker extends CredentialResolver {
  constructor(data: VaultData = {}, env: NodeJS.ProcessEnv = process.env, definitions: CredentialDefinition[] = providers, options: ResolverOptions = {}) { super(definitions, data, { ...options, env }); }
}
