# Portable credential resolution (v0.5 P1-C)

CredentialResolver is implemented in `packages/credentials`. Compute's
CredentialBroker supplies the authoritative provider catalogue; its former
vault/broker/redaction duplicates now delegate to that package. Existing
AES-256-GCM/scrypt v1 vault files remain compatible. There is no second vault.

Resolution of `credential://provider/<id>` is server-side, in order:

1. Explicit session/runtime injection, scoped per provider.
2. Existing unlocked or encrypted Beyonder vault.
3. Injected environment-specific SecretBackend adapter.
4. Injected OS_KEYRING adapter.
5. Declared environment variables (including existing dotenv compatibility).
6. Typed unavailability.

Backend interfaces are supported, but no working OS keyring, cloud manager or
Work secret-injection service is claimed for this installation. A backend must
return all required parts from one source. A scope denial does not fall through
and accidentally authorize another source. Inference does not authorize spend.

## Portability and master key

Defaults are `.providers-vault/vault.json` and
`.providers-vault/credential-manifest.json`, under BEYONDER_REPO_ROOT or cwd.
Explicit BEYONDER_CREDENTIAL_VAULT_PATH and BEYONDER_CREDENTIAL_MANIFEST_PATH
support mounted storage. Master material comes from an injected async masterKey
callback, BEYONDER_CREDENTIAL_MASTER_KEY, or the compatible
PROVIDER_BOOTSTRAPPER_MASTER_PASSWORD variable. It is never written to the vault,
manifest, SQLite, frontend or Git. The existing directory remains gitignored.

Transport the encrypted blob and safe manifest through authorized storage.
Inject the master separately using the destination's secure mechanism. Merely
copying metadata cannot make a credential accessible or prove validity.

Vault locked with confirmed manifest metadata means configured/present true,
accessible false, valid UNKNOWN. A locked blob without per-provider metadata
means configured/present UNKNOWN: it cannot reveal which entries it contains.
Absence of sources/history here is NOT evidence about secrets on another machine.

The manifest whitelists logical identity, configured/present, source, scope,
accessibility, status and last validation metadata. Arbitrary fields, supplied
validity claims and secret values are not trusted/copied. Historical catalogue
validation can establish past configuration; a general state-update timestamp
is not reused as a credential-validation timestamp. Current health, models,
quota and capability stay separate from credential state.

## Explicit migration (does not modify .env)

From the authorized environment where declared provider variables exist:

```
pnpm exec tsx --import dotenv/config packages/compute/src/cli.ts credentials:import-env groq
pnpm exec tsx packages/compute/src/cli.ts credentials:status
```

The first command is explicit opt-in: checks logical provider, encrypts, rereads
and verifies, refuses to overwrite an existing provider entry, and records safe
configuration metadata. It never erases or rewrites environment/.env values.
Use the injected master or the masked interactive password prompt. Never put a
master or token in command-line arguments.

The explicit dotenv loader in the import command reads the installation's
authorized `.env`; exported environment variables need no loader. The resolver
does not search arbitrary files, and neither command modifies `.env`.

For an operator who can confirm historical local configuration but cannot move
its secret yet:

```
pnpm exec tsx packages/compute/src/cli.ts credentials:remember-configured gemini
```

This records LOCAL_ONLY, not validation/accessibility. No automatic historical
claims are fabricated for providers without records. Session injection uses
injectSessionCredential(provider, declaredValues, ['inference']); its values stay
in server memory and clearSessionCredential removes them. Adapter callbacks
are supplied to CredentialBroker/Resolver via ResolverOptions.

## Consumers and security

All 29 current catalogue providers are covered by the shared definitions,
including Gemini/Google alias, Groq, OpenRouter, Cohere, Hugging Face, Kilo, OVH,
AI Horde, Cloudflare (both required parts) and NVIDIA NIM. Runtime automatic
inference, validation, provider orchestration, CLI, Resources and NVIDIA smoke
use resolve. Benchmark target construction retains synchronous compatibility
getters, with prepare required for encrypted/adapter sources. The explicit
OpenAI-compatible endpoint also resolves centrally; its legacy configuration
key remains a non-enumerable compatibility field. Its UNKNOWN_COST routing
restriction is unchanged.

Direct env accesses are classified as: migrated provider lookup (A), central
source bindings/dotenv/master-key prompt/explicit config compatibility (B), and
isolated test setup (C). There are no remaining catalogue provider API-key
lookups in execution or validation outside the central layer.

ResolvedCredential stores material in private fields and serializes metadata
only. Legacy secret records and benchmark target keys are non-enumerable.
Recursive redaction covers api_key/apikey/apiKey/token/secret/authorization/
bearer/private_key/credential(s) variants; partial-secret fingerprints were
removed. Resolution/validation events contain metadata only. Backend/network
exceptions are sanitized; provider auth failures record typed metadata, never
raw echoed response secrets. The router preserves upstream numeric HTTP status
when redacting diagnostic errors. An echoed credential in a catalogue is refused.

Typed failures: CREDENTIAL_NOT_CONFIGURED, CREDENTIAL_SOURCE_UNAVAILABLE,
VAULT_LOCKED, CREDENTIAL_DECRYPTION_FAILED, CREDENTIAL_INVALID,
CREDENTIAL_EXPIRED, CREDENTIAL_SCOPE_INSUFFICIENT and PROVIDER_AUTH_FAILED.
Expired is available as a backend/validation classification; no fictional
expiry detection is claimed. Provider/catalogue/quota/capability failures remain
independent operational states.

No BIB/performance history is deleted because a source becomes inaccessible.
An observed historical model is currently ineligible if credentials are
inaccessible or known invalid. Failed accessibility checks must not replace a
previously observed authoritative catalogue with an invented empty catalogue.
Resources exposes metadata in an existing provider disclosure, without redesign.

An unreadable manifest does not block an independently accessible session, vault
or environment credential. Without another source, configuration/presence remain
UNKNOWN and the status is CREDENTIAL_SOURCE_UNAVAILABLE. Corrupt metadata is not
silently overwritten. Vault parsing/decryption failures use constant typed errors;
Control Center JSON/schema validation never returns raw received values.
