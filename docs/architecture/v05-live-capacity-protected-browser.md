# v0.5 live capacity and protected research

This pass starts at `046b2cab05e52c2dd60f19a398825961d369d752` on
`feat/v05-final-integration`. Qualification requires live product acceptance as
well as CI. No merge or economic action is authorized by this document.

## Findings and boundaries

The original 38 Control Center objectives yielded four verified successes,
26 capacity blocks, seven failures and one legitimate input request. The full
chains were retained before changing code. A block without a producer does not
prove that an independent verifier was unavailable; those are separate phases.

The installation had no inference credentials. Public model catalogs do not
prove authenticated inference, free pricing, model quality or remaining quota.
Existing keyless capacity was tested first. Live OVH pricing excludes paid
models even if old static metadata classified the provider as free. An explicit
`isFree: false` also overrides zero token prices and models with paid extras.
Unknown prices remain ineligible. Dynamic gateway aliases and non-chat models
are excluded from the physical producer/verifier pool.

The gateway's [billing documentation](https://kilo.ai/docs/gateway/usage-and-billing)
states that `:free` requests are tracked but not billed. Reported upstream market
or gateway processing cost is not substituted for the installation's monetary
charge. The documented shared free limit is 200 requests per IP per hour; its
gateway-level rejection excludes sibling models too. It is not bypassed with a
different model or authentication.

The usable pool is installation evidence, not a list of permanently free
providers. Kilo exposes zero-priced physical models, including Step, Dots and
Nemotron Ultra; actual responses and failures are retained. Quota remains
UNKNOWN. Some catalog descriptions explicitly identify trial capacity and
training/data-use terms. Successful repeated calls do not establish unlimited
capacity or a billing guarantee for different endpoints.

## Capability and accounting

Both CLI and Control Center read the same installation BIB. The dashboard
resolves its path against the repository root, rather than accidentally opening
a second empty database in its package directory. Runtime outcome history is
preserved across acceptance rounds.

Measured dimensions include reasoning, planning, coding, research, synthesis,
tool use, structured output, verification and evidence grounding. A dimension
requires at least two distinct evaluated cases in the matching inference
profile. Repeating one easy case does not qualify it. Scores for unmeasured
dimensions keep their metadata prior; a synthesis pass cannot certify coding.
Small supplied-document benchmark cases measure model behavior and are never
counted as live browser evidence for a mission.

Profiles distinguish reasoning control and output budget. The actual structured
request mode is persisted separately. A prompted-JSON qualification is not
silently switched to catalog-declared native JSON in production; legacy unknown
modes stay unknown. This preserves the measured request profile without raising
the output budget or changing the floor. Failed old profiles
remain queryable. Operational failures carry no semantic quality grade.
Operational observations are available across categories without manufacturing
a quality score. Catalog lookup latency is not model inference latency; an
unmeasured model does not receive an instantaneous-response advantage.

`predictedQuality` already updates BIB/metadata priors with real outcomes. The
overall fit combines this posterior with separately observed reliability,
without counting the same outcome a second time. Sustained poor outcomes still
reduce eligibility. MINIMAL/STANDARD/HIGH base floors remain 0.46/0.59/0.71,
including the existing complexity adjustments and required dimensions.

Requirements are resolved by execution phase. Completed incidental planning
and tools need not be performed again by synthesis or verification. Explicit
GoalContract requirements, freshness, evidence and quality target remain.
An explicit planning goal takes precedence over incidental research vocabulary;
it does not acquire an easier quality target as a consequence.

Normal product routing selects the best qualified candidate. Deliberate
exploration requires an explicit experimental opt-in. The policy remains:
STRONG_FREE_CLOUD → OTHER_FREE_CLOUD → PAID_DISABLED → LOCAL_EMERGENCY.
Local cannot reserve or displace a qualified cloud attempt.

Unavailable independent verification does not mean the producer's answer was
semantically evaluated as wrong. Economic Memory retains the blocked objective,
cost and failure, while leaving quality unevaluated. Legacy rows are interpreted
using persisted checkpoints, without deleting historical outcomes.

Provider-wide and model-specific limits are distinct. Upstream account/pool
errors and concrete shared-capacity `limit_rpd/vendor/model/account` keys block
the affected model. Unscoped gateway account/daily quota remains provider-wide.
Legacy wrong scopes are repaired only using the matching retained original
attempt; the original long backoff stays on the affected model. Catalog refresh
never clears quota. Authentication repair requires a newer actual successful
zero-cost inference, rather than a public catalog response.

A real HTTP 200 can contain an upstream error envelope. Its explicit upstream
HTTP code is classified as an operational failure (overload, rate limit or
authentication), rather than semantic answer quality. The physical HTTP status
remains 200 in the attempt; `upstreamHttpStatus` records the separate observed
upstream code. Missing or invalid upstream codes remain invalid output. No error
envelope counts as an answer or successful verification.

## Independent verification

Producer and verifier must have distinct physical model identities, including
when exposed through different gateways. Actual response attribution is checked
again after gateway routing. Missing attribution or a remapped producer identity
cannot certify independence. Native JSON mode is requested only
when supported and the observed request profile does not establish a different
mode. Otherwise the model receives a prompted schema and
the verdict is parsed strictly. Unexpected fields, inconsistent booleans,
unsupported claims and incomplete answers fail closed.

The verifier receives the complete bounded result, observed browser excerpts
and completed non-browser tool outputs, including calculator arguments and
results. It cannot certify an unsupported current claim from background
knowledge. Search-interest indices cannot establish universal language usage.
The opening and conclusion must preserve the scope of the observed metric.

TypeScript results receive bounded strict static compilation as an isolated
module (local declarations do not collide with unrelated ambient DOM names), without executing
or emitting generated code or resolving arbitrary files/imports. Compiling alone
does not establish requested behavior; independent semantic verification remains
required. Source snapshots preserve deletion/strikethrough semantics and exclude
superseded claims from current evidence. Static definitions and negative goal
constraints are explicitly included in independent review.

Human review found a type-correct grouping function that failed on valid inherited
object-key inputs. The original producer response, independent approval and
counterexamples remain retained as a false success, rather than being relabeled
as a pass. Both actual model observations receive failed coding/verification
grades in BIB. Independent review now checks declared domains and counterexamples;
adversarial verification cases require the full verdict envelope. A prior simple
factual verification benchmark is not evidence that this defect was caught.

Terminal completion time includes independent verification and recovery; the
producer execution timestamp is retained separately. Execution finishing remains
distinct from objective verification. No blocked,
failed or unverified result is promoted to success.

## Protected browser transport

This environment requires an egress proxy; direct public TCP connections fail.
The protected path is URL validation → bounded A/AAAA resolution → reject any
private/reserved result → select a validated address → proxy CONNECT to that
address → TLS with original SNI and hostname verification → original Host →
HTTP/1.1 response → bounded complete buffering and decoding → Chromium.
The proxy does not re-resolve the target hostname. CA validation stays enabled.

Redirect fulfillment exposed a security defect: Chromium could follow an HTTP
redirect without invoking another route handler. Protected main navigations
now stage a separately intercepted, validated navigation; Chromium never
receives that HTTP redirect. Subresource/method redirect chains are likewise
validated and pinned, with bounded hops and cross-origin credential stripping.
Real Chromium regressions prove that public-to-private redirects never reach
the private test server. Existing rebinding, mapped IPv6, URL tricks, private
ranges, side-effect authorization and download boundaries remain enforced.

Transport handling preserves cookies and strict TLS, bounds queue/stream time
and compressed/decoded size, decodes gzip/deflate/Brotli, and rejects truncated
responses. Repeated response headers are combined according to their field
semantics: ordinary repeated fields use commas, while Set-Cookie remains separate.
Read sessions also block script/XHR/beacon mutations. A runtime-approved form
submission receives a short-lived one-use destination/method grant restricted
to the authorized session's main-frame form navigation; scripts cannot consume
that grant by writing to the same destination. Unrelated
writes and mutation replays through redirects are denied. The unsupported
WebSocket channel is explicitly closed and cannot bypass the pinned HTTP(S)
transport. Owned local-server regressions verify these boundaries.

Newline-joined Report-To fields had caused Chromium navigation to time out even
after the complete body arrived. Search discovery can read server-rendered text
without JavaScript in a new protected session; source pages retain dynamic
rendering. Neither mode relaxes the network or side-effect boundary. HTTP error pages cannot become observed source evidence. Incomplete
DOM snapshots are not accepted merely to make navigation faster.

## Discovery and product lifecycle

Official source identities and stable documentation entry points are candidates,
not answers. Versions, ranking values and release dates are collected live.
Discovery pages and links are excluded from source evidence. Source minima are
not maxima: additional explicitly requested relevant sources are preserved.
Stack Overflow follows observed Results and Technology links without a fixed
survey year. Source errors and fallback attempts remain visible in audit. Explicit conditional
fallback URLs belong to one required source slot; two independently requested
sources remain two slots. Query tokenization preserves short subjects such as Go,
C and R. No CAPTCHA, authentication or rate-limit challenge is bypassed; blocked
public discovery engines cannot contribute source evidence.

Mission polling retrieves the requested persisted identity directly, including
missions older than the first 200. List projection applies pagination before
expensive evidence/redaction derivation in SQLite. Shadow-cost and verified-today
aggregates cover all unique persisted missions, rather than only the displayed
20/200. Corrupt or incompatible checkpoint versions remain fail closed. The
supervisor health query reads current mission status and the relevant capacity
event; it does not construct Home or redact historical source evidence. A measured
978 ms health query had been polled every 500 ms, starving protected browser IO.
The equivalent read after the change measured 74 ms on the same retained history. Historical mission states are retained;
the Home capacity header describes current work rather than any past block.
Catalog validation alone does not mark inference as verified or health known.
Cold Home loads restore the current or most recent persisted mission to Command,
including its complete verified result or honest blocking reason. Compact history
cards remain compact; refresh does not discard the command context.

Safe shutdown rejects new work and drains an already accepted mission through
verification. Emergency stop remains available during draining. The supervisor
does not exit before active work and the shutdown response have completed.
Checkpoints, execution leases, pause/resume, durable SQLite results and approval
boundaries remain authoritative.

## Qualification evidence

Live corpus, calibrated raw responses, routing/verifier/browser traces and
screenshots are retained in `beyonder-p1-evidence` in the execution workspace.
Controlled inference stays in separate databases and is labeled explicitly.
Neither fixture evidence nor synthetic performance enters the live installation.
Final readiness depends on the completed live corpus, analog journeys, protected
browser regressions, all technical gates, visual QA and CI at the final HEAD.

Monetary cost and realized revenue remain zero. Shadow cost is separately
reported. No application, submission, payment, wallet, trading, x402 or other
external economic mutation is executed by this pass.
