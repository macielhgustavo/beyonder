export type CredentialFailure = 'CREDENTIAL_NOT_CONFIGURED' | 'CREDENTIAL_SOURCE_UNAVAILABLE' | 'VAULT_LOCKED' | 'CREDENTIAL_DECRYPTION_FAILED' | 'CREDENTIAL_INVALID' | 'CREDENTIAL_EXPIRED' | 'CREDENTIAL_SCOPE_INSUFFICIENT' | 'PROVIDER_AUTH_FAILED';

export class CredentialError extends Error {
  constructor(readonly code: CredentialFailure) { super(code); this.name = 'CredentialError'; }
  toJSON() { return { code: this.code }; }
}
