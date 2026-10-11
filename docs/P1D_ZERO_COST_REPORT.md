# P1-D — zero-cost execution guarantee

START_HEAD: `567c58e6c5a75036b777cb2c823db9705016cb73`.
Branch: `feat/v05-final-integration`; fetched, clean and aligned before changes.
FINAL_HEAD is the commit containing this report, reported after publication;
retrieve it with `git log -1 --format=%H -- docs/P1D_ZERO_COST_REPORT.md`.
No merge, new branch, paid escalation, floor reduction or v0.6 work.

## Bugs and economic invariants

Adaptive selection assigned `monetaryCostUsd = 0` without execution-specific
price evidence. Catalogue eligibility/bootstrap READY could therefore look like
free usable compute. Explicit OpenAI-compatible completion, the legacy models
router, benchmark completion and NVIDIA smoke also had paths lacking a common
execution gate. An unknown/malformed reported usage value could be coerced into
zero. Gateway aliases could masquerade as independent physical judges.

The new compute economic layer separates price class, account billing, free-tier
eligibility, current free quota, effective spend cap, billing behaviour and
spillover. Decisions are ZERO_COST_CONFIRMED, FREE_QUOTA_CONFIRMED, UNKNOWN_COST,
PAID, BILLING_RISK, FREE_QUOTA_EXHAUSTED or BILLING_STATE_UNKNOWN. Monetary value
is a discriminated CONFIRMED_ZERO/UNKNOWN object. UNKNOWN has no `usd: 0` field.
No score, positive budget, accessible credential or bootstrap status can override
PAID, billing risk or observed exhausted quota. Capability evidence is retained.

Execution needs price/account proof AND credentials/operational access AND
workload/quality constraints. The existing independent-verifier allocation and
safety requirements still apply to missions; this pass does not relax them.
Selection emits economic provenance/rejections; the physical request boundary
reloads current catalogue, quota and credential/account proof to close selection
versus execution races. Direct unknown endpoints are blocked. Legacy models
routing delegates to the qualified runtime instead of maintaining a bypass.

## Proof sources and limits

1. Explicit fixed free routes on the exact supported OpenRouter/Kilo endpoints,
   with freshly observed all-zero catalogue pricing, including extra price
   fields. OpenRouter requires `:free`; Kilo also requires observed explicit-free
   metadata. Discovery, names alone, `isFree` alone and static priors do not
   authorize execution. Prices expire after 24 hours; derived decisions expire
   in at most 60 seconds. Requests fix the model, disable gateway fallback,
   constrain prompt/completion maximum price to zero and reject HTTP redirects.
   Unknown quota can yield a free rejection, never authorize paid spillover.
   Observed fresh zero remaining quota is a hard veto.
2. Current account-specific evidence from a trusted provider-account backend or
   operator who actually verified account protections. Proof binds provider,
   model, exact endpoint, validated credential source/revision and five-minute
   validity. It requires current free quota and free eligibility, plus enforced
   zero spend cap or disabled billing with reject-after-free and no spillover.
   Account proof can qualify otherwise unknown catalogue pricing; a PAID model
   remains disabled. Credits and low expected prices are insufficient.
3. Local loopback Ollama with installed non-cloud model metadata. Remote Ollama
   endpoints/cloud models and failed or proxy-reported local discovery are
   refused. Local remains quality-gated emergency compute, with shadow/resource
   cost separate from monetary provider cost.

No account-billing API adapter was invented or qualified in this Work environment.
The account evidence interface and explicit `BEYONDER_ZERO_COST_EVIDENCE_PATH`
loader are implemented; the latter accepts an allowlisted versioned account
snapshot, not arbitrary env booleans or secrets. An operator must obtain its
claims from actual account controls/current provider observations. Merely creating
a file does not validate a credential or prove a billing cap. Missing, malformed,
stale, copied or differently scoped proof fails closed. Generic rate-limit
headers prove neither free-account eligibility nor billing protection.

Gateway zero-charge protection relies on the supported gateway's fixed free-route
and zero-price contract. A response contradicting this contract halts runtime
provider execution, persists an economic stop when a StateStore is installed,
and records the reported charge instead of hiding it as zero. Benchmark stops
all targets after a charge; invalid monetary usage aborts without a fabricated
zero-cost BIB row, and the client refuses further models on that provider.
No code can guarantee a third party will honour its contract; unsupported or
unproven protections are rejected rather than guessed.

## Identity, bootstrap and UI

`physicalModelIdentity()` collapses fixed free gateway spellings of the same
physical model, preserving version distinctions. Producer/verifier comparisons
require two nonempty, different identities. Dynamic auto/free/stealth aliases
supply no independent identity; returned physical attribution is checked.
A model through both Kilo and OpenRouter counts once for independence.

Bootstrap READY, validated catalogue, economic readiness, inference qualification
and verifier qualification are separate. AI Horde skipped validation does not
establish a catalogue, inference or verifier qualification. Metadata-only
inventory cannot certify model quality; its qualification flags remain false or
UNKNOWN, never true from catalogue/auth alone. Router BIB safety remains the
source of historical qualification/negative adjudications.

Resources retains the premium layout and adds a disclosure with price class,
price source, free quota, spillover, economic readiness, separate qualification
flags and rejection reason. Unknown economic evidence is not displayed as $0.
The summary explicitly counts zero-cost readiness rather than generic READY.
This financial/bootstrap signal does not promise a response or objective success;
execution still checks current health/cooldown, quota and quality/verifier gates.

## Actual environment inventory and inference

Portable full provider/model matrix:
[`checkpoint-evidence/v05-zero-cost-inventory.json`](../checkpoint-evidence/v05-zero-cost-inventory.json).
It includes fallback catalogue rows and a no-observed-model placeholder; these
are not all live discoveries. No authenticated provider audit was repeated.

Before the one selected Kilo catalogue refresh: 29 providers, 478 model rows,
zero economic-ready rows. Legacy price metadata was not silently upgraded.
The single read-only live Kilo GET observed 401 catalogue models and established
12 fixed free routes with current all-zero pricing. Other providers' historical
catalogues were preserved. The refreshed matrix has 480 rows: 74 free-tier
eligible, 405 paid, one unknown. Only Kilo has financially ready routes here;
this is not a pool of qualified independent producers/verifiers.
Authenticated credential accessibility in Work remains zero. Workstation
credentials/history are not assumed absent; P1-C was not reopened.

- Gemini `gemini-2.5-flash`: NOT_RUN_LOCAL_CREDENTIAL_REQUIRED, zero calls.
- Kilo `thinkingmachines/inkling-small:free`: one bounded operational call,
  32 maximum output tokens; HTTP429 RATE_LIMITED, 709ms, free quota EXHAUSTED,
  reset observed `2026-10-10T00:00:00.000Z`, monetary cost US$0.
- No equivalent retry, paid/unknown inference, verifier counterexamples, positive
  goldens, subset or 38-objective matrix followed this unavailable candidate.
  Other financially ready catalogue entries remain unqualified, including the
  previously unsafe Step5 verifier. They are not promoted by economic evidence.

The inventory is a timestamped financial/catalogue snapshot. Its UNKNOWN quota
for Inkling is superseded by the live failure above; reset is not proof of new
quota. The initial live probe predates the final harness's durable attempt
recording; its incomplete scope was not fabricated into provider-wide state.
The final harness uses the existing runtime StateStore/recordAttempt path, retains
actual scoped quota/reset/cooldown across restart, and stops before another POST.
That persistence is proven by an isolated HTTP429 integration regression; no
additional live call was made to repeat the known exhausted path.

## Validation

Focused economic tests passed before broad validation. Coverage includes user
cases A–O: account/free quota/no spillover; exhaustion; unknown/paid/risk;
valid credential with unknown price; READY/keyless with paid model; same physical
model across gateways; unresolved aliases; skipped Horde; no implicit zero;
positive budgets never enabling paid; and durable capability/BIB preservation.
Also tested price/quota drift before POST, scope/revision/expiry mismatches,
malformed/reported positive usage, reported-charge audit preservation, no secret
serialization, all-target benchmark stop and provider stop after contradictory
usage. Three controlled operator CLI scenarios use blocked external network;
none are live performance evidence. A scoped quota/restart case preserves sibling
provider eligibility while blocking another POST on the exhausted model.

- `pnpm build`, `pnpm typecheck`: PASS.
- One complete `pnpm test`: PASS, 760 tests. Final changed-area reruns: compute50,
  benchmark79, integration4 PASS; unchanged groups tools15, runtime524,
  browser69 + network classification4, web-evals20 remain PASS. This gives
  765 distinct root cases with final relevant reruns, not repeated full CI.
- Credentials19; Control Center53, typecheck and production build: PASS.
- Security smoke7 checks: PASS, cost0. Hardening smoke: PASS, cost0.
- Total distinct local cases: 837; fixture performance never enters real BIB.
- Whitespace/diff check: PASS. No dependency/lock changes or repeated install.
- No remote CI_GREEN, Visual QA, 38-objective acceptance or overall v0.5
  qualification claimed. No paid inference was attempted.

Read-only checks after this pass: both real BIBs still have542 rows and19
VERIFIER_FALSE_APPROVAL adjudications. No history erased, no synthetic rows
inserted into production BIB/Economic Memory; real smoke diagnostics are separate.
Economic rejection changes execution eligibility, not historical capability.
Additional monetary cost: US$0. Shadow cost of live inference: UNKNOWN.

## Safe local commands and next steps

Use authorized P1-C vault/master injection or existing env compatibility locally;
never send secrets in chat or arguments. Build first, then refresh only the
selected provider's GET catalogue and inspect economic evidence:

```sh
pnpm build
pnpm providers:zero-cost-inventory
pnpm providers:zero-cost-inventory --provider openrouter --refresh-catalog
pnpm providers:zero-cost-smoke --provider openrouter --model thinkingmachines/inkling-small:free
```

The example model must still exist as an exact, financially ready fixed route
in the just-observed inventory; otherwise the command refuses inference.
For Gemini/NIM/Cloudflare/etc., catalogue/free-tier eligibility and credential
validation alone remain blocked without current account billing/quota/cap proof.
An authorized account backend can provide that snapshot via
`BEYONDER_ZERO_COST_EVIDENCE_PATH`; it must match the validated credential revision.
No account configuration is modified and no billing or paid endpoint is enabled.
The smoke requires explicit provider/model, makes at most one 32-token call,
uses persistent runtime cooldown/economic stops, emits safe status/latency/quota,
and marks a successful result PASS_OPERATIONAL_ONLY, not verifier/capability
qualified. Inventory without `--refresh-catalog` never calls provider endpoints.

Next compute work: obtain usable observed free quota, qualify a safe independent
verifier using retained counterexamples plus two unseen analogues, then coding,
planning, current-info and multi-source goldens. Use the unchanged quality floor,
real browser and physical identity constraints. Subset/38 only after material
safe producer/verifier capacity. Do not retry Inkling before a real capacity
change; Oct10 reset alone cannot establish it. No new credential creation asked.

## Delivery status

P1-D implementation/security/regression gates ready; remaining external unknowns
are account billing/free-quota controls and real model/verifier availability.
P1-A remains unresolved, P1-B not requalified; old Step5 false approval remains
negative evidence, not a product SUCCEEDED. No new full product mission ran.
No additional P0/P1 in the validated P1-D scope; prior product P1s remain open.
No v0.5-ready claim or P2 relabelling of those blockers.

ZERO_COST_EXECUTION_GUARANTEE_READY=true
P1-D_READY=true
PORTABLE_CREDENTIAL_RESOLUTION_READY=true
PRODUCT_CORE_READY=false
LIVE_COMPUTE_READY=false
BROWSER_RESEARCH_READY=false
HUMAN_ACCEPTANCE_CANDIDATE=false
V0_5_CANDIDATE_READY_FOR_GUSTAVO=false

Publication is a fast-forward on the existing branch with `[skip ci]`, preserving
all checkpoint provenance. This avoids repeating full remote CI while functional
capacity remains unqualified. Working-tree cleanliness and origin alignment are
verified after publication and reported with the exact FINAL_HEAD.
