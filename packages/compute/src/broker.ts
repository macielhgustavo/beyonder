import { CredentialBroker as CentralBroker, type ResolverOptions, type VaultData } from '@beyonder/credentials';
import { providers } from './catalog.js';
import { AutopilotStateStore } from './state-store.js';
export class CredentialBroker extends CentralBroker {
  #statePath: string;
  constructor(data: VaultData = {}, env: NodeJS.ProcessEnv = process.env, options: ResolverOptions & { providerStatePath?: string } = {}) { super(data, env, [...providers, { id: "openai-compatible", authType: "bearer", credentialEnvVars: ["OPENAI_COMPAT_API_KEY"] }], options); this.#statePath = options.providerStatePath ?? env.BEYONDER_PROVIDER_STATE_PATH ?? '.providers-vault/autopilot-state.json'; }
  override async resolve(id: string, scope: Parameters<CentralBroker['resolve']>[1] = 'inference') {
    const result = await super.resolve(id, scope);
    if (!result.descriptor.accessible && result.descriptor.configured !== true) {
      const previous = (await new AutopilotStateStore(this.#statePath).read()).providers[result.descriptor.provider];
      if (previous?.validation?.status === 'validated' && result.descriptor.expected) {
        result.descriptor.configured = true; result.descriptor.present = true;
        if (result.descriptor.status === 'CREDENTIAL_NOT_CONFIGURED') { result.descriptor.status = 'CREDENTIAL_SOURCE_UNAVAILABLE'; result.descriptor.source = 'LOCAL_ONLY'; }
        // A state transition timestamp is not a credential validation timestamp.
        // Keep UNKNOWN/null unless a source has actual credential validation metadata.
      }
    }
    return result;
  }
}
