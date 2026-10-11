# P1-C delivery — portable credential resolution

START_HEAD: a12309d1469ca84a2969e943e01097238ba03039
REVIEW_START_HEAD: 7891119aac2d630588c10640ea4676ea28cd28a5
Branch: feat/v05-final-integration. FINAL_HEAD is the commit containing this
report, published on that same branch (see git log); no merge.

## Findings and fix

The existing AES-256-GCM/scrypt vault was implemented twice. CLI could unlock
it, whereas runtime inference looked up process.env directly and Resources
independently inferred configuration from env. This was a real portability
regression: historically qualified models could retain history but lose current
executable access with insufficient explanation.

The canonical vault/broker/redaction now lives in packages/credentials.
Compute delegates to it, using its current catalogue rather than the older
credentials catalogue. Logical resolution and safe metadata are separate from
physical values. Production lookup sites migrated: automatic and explicit
runtime inference, provider validation, orchestration, CLI, dashboard secret
configuration/Resources, and NVIDIA smoke. All29 catalogue providers are covered.
Benchmark target construction keeps central synchronous compatibility access;
CLI prepares it for vault/adapters first. No catalogue provider remains on an
independent legacy credential lookup. Existing dotenv and explicit endpoint
configuration are compatibility bindings, not a new secret store.

Sources implemented: scoped session injection, existing portable encrypted
vault, environment compatibility. Ordered SecretBackend adapters cover an
operator-supplied environment backend/keyring; this environment does not have
an installed keyring/cloud-secret-manager integration. Master-key callback and
injected env support destination-specific authorization without persistence.
Explicit env import encrypts, verifies and refuses silent replacement; it does
not modify .env. Safe manifest records history without proving accessibility.
Configuration can remain UNKNOWN when a locked blob has no per-provider manifest.

Typed errors, metadata-only observability, recursive redaction, private values,
non-enumerable compatibility values, sanitized errors and refused credential
catalogue echoes provide the tested security boundaries. Redaction originally
missed plural credentials; the regression found it and the filter was fixed.
Redaction preserves actual/upstream HTTP statuses and retry metadata.

Resources adds a provider disclosure for configuration, accessibility here,
source, status, validation, timestamp and scope. No redesign. UNKNOWN remains
UNKNOWN, and inaccessible/invalid credentials cannot masquerade as READY.
Health/quota/model availability/capability remain separate.

The follow-up review reproduced five credential-source failures and two API
disclosure failures before fixing them. A corrupt/unreadable manifest previously
blocked valid session, environment and vault credentials. It now degrades to
UNKNOWN metadata while resolution continues; unavailable metadata alone never
becomes proof of a missing credential. No corrupt manifest is overwritten.

Native vault parser exceptions and Control Center JSON/schema validation could
echo opaque received values. Shared typed credential errors now sanitize vault
reading/import failures; the command API returns constant JSON/schema errors.
Three API regressions exercise the real POST handler, including malformed-vault
setSecret failure with no secret/master disclosure or mutation. Encryption,
scope boundaries, provider policy and visual design are unchanged.

## Measurement and live capacity

2026-10-08T23:43:39.488Z, authorized sources only; no provider network requests:

| Metric | Result |
|---|---:|
| Current catalogue |29|
| Providers requiring credentials |26|
| Accessible credentialed providers |0|
| Historically configured auth providers proven here |0|
| Previously missing reclassified by available history |0|
| Providers recovered |0|
| Additional live inference smokes |0|
| Additional monetary cost |US$0|

No vault or manifest exists in this installation. Available provider history
contains Kilo and OVH keyless. This says nothing definitive about secrets or
metadata on the workstation. No secret recovery is invented. Consequently no
provider classification changed materially to justify new live network audits,
model smokes or the38 objective matrix. P1-A is still externally constrained.

BIB/Economic Memory: no real performance observation created or erased by this
pass. Metadata tests never become BIB performance evidence. The existing19
adjudicated unsafe observations and safety gate remain preserved, with542 rows
in each BIB after the separate compute retry checkpoint. Historical
catalogue/capability evidence is retained when credentials become inaccessible;
current execution rejects such candidates without weakening any quality floor.

## Validation

- Credential resolver/redaction:19 tests PASS, covering A–I/K (session, vault,
  locked/configured vs missing, env, invalid present key, scopes, metadata,
  serialization/events and two portable injection modes).
- Focused provider validation/broker/autopilot/vault:23 tests PASS, including J central auth and L
  inaccessible historical state/catalogue retention, plus secret echo refusal.
- Focused router:15 tests PASS; locked candidates excluded with history preserved.
- Focused API/Resources/redaction/security:16 tests PASS.
- Complete pnpm test PASS:713 tests across compute/tools/runtime/benchmark/browser/
  network-failure classification/web-evals/integration. Includes501 runtime tests.
- Control Center:52 tests PASS, including credential data serialization and
  configured-but-unavailable truth; typecheck PASS.
- Root build/typecheck PASS. Frozen offline install passed in the initial P1-C
  implementation; no dependencies changed or install was repeated in this review.
- Control Center production build PASS. Security smoke:7 checks PASS, cost0.
- Focused diagnostic-status regressions:401/429/503 upstream metadata PASS.
- Diff whitespace check PASS.

Two historical mocked routing tests depended on READY implying credentials;
explicit isolated test credentials were added, without changing assertions or
production eligibility. The end-to-end integration regression then passed.
Root713 + credentials19 + Control Center52 =784 local tests. Focused tests ran
before the broader suite. Review environment: Node24.19.0/pnpm11.19.0.
No Visual QA, full remote CI,38/live matrix or Inkling replay was run for P1-C.
These local tests do not imply qualification of the whole product.

## Remaining work

Operator may transport an authorized encrypted vault+safe manifest and inject
its master separately; no secret/master should be sent in chat. Revalidate only
providers whose accessibility changes, with zero billing risk. Otherwise keep
the latest Inkling reset2026-10-09T00:00:00Z plan: verifier contraproofs+2analogues,
positive coding/planning/current/multi-source goldens, subset,38 only after
material safe producer/verifier capacity. Controlled21/24 earlier remains an
unresolved prior result, not reclassified as PASS.

The separate7891119 checkpoint already performed the post-Oct8-reset probe:
Inkling HTTP429, quota0/1000; Step5 answered OK but failed its first model-level
verifier counterexample. This was not a product mission SUCCEEDED, and the final
two-review protocol was not run. See checkpoint-evidence/2026-10-08-compute-retry.json.
P1-C does not retry these providers or erase that negative evidence. Reset alone
does not guarantee shared capacity. Without newly authorized accessible sources,
code cannot recover workstation secrets or create upstream quota.

PORTABLE_CREDENTIAL_RESOLUTION_READY=true
PRODUCT_CORE_READY=false
LIVE_COMPUTE_READY=false
BROWSER_RESEARCH_READY=false
HUMAN_ACCEPTANCE_CANDIDATE=false
V0_5_CANDIDATE_READY_FOR_GUSTAVO=false

Working tree/remote publication verified after commit and reported with exact
FINAL_HEAD in the delivery. CI_GREEN is not claimed. No merge, paid escalation,
local promotion, floor change or economic external action.
