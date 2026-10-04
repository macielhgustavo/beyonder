# v0.5 research-derived delta audit

Baseline: `0572aaf1f985eff74d0e971006da072bbfa9db25`. This audit is a release-safety delta, not a v0.6 feature pass.

## Connection-bound browser policy

The former flow validated a DNS result and then called `route.continue()`, allowing Chromium to perform an independent lookup. That was vulnerable to DNS rebinding.

Every intercepted HTTP(S) request now follows one enforcement boundary:

1. validate scheme, domain and executable policy;
2. resolve every physical request;
3. reject the complete answer set if any address is loopback, private, link-local, mapped-private or otherwise internal;
4. select an allowed address;
5. pass that address to `PinnedHttpTransport`;
6. make the socket use that exact address through its `lookup` callback while retaining the original hostname for `Host`, TLS certificate validation and SNI;
7. fulfill the browser route with the response instead of allowing Chromium to reconnect independently.

Redirects and subresources create new intercepted requests and repeat the same process. Connections do not use a shared agent, preventing a socket opened under another policy from being reused. Browser cookies remain browser-owned and are forwarded through request/response headers. Regression coverage includes alternating public/private DNS, localhost, RFC1918, metadata/link-local, private IPv6, IPv4-mapped IPv6, redirects, subresources, TLS/SNI and cookie-preserving redirects.

## Checkpoint truth and execution ownership

Checkpoint reads distinguish `CHECKPOINT_NOT_FOUND`, `CHECKPOINT_VALID`, `CHECKPOINT_CORRUPT`, `CHECKPOINT_VERSION_UNSUPPORTED` and `CHECKPOINT_IO_ERROR`. Only NOT_FOUND maps to absence. Corrupt, unsupported and storage-error states become explicit blocked/attention states and cannot silently restart work.

Task execution uses a SQLite-backed lease keyed by logical task ID. Acquisition is atomic across independent processes. A second live owner receives `ALREADY_RUNNING`; a lease owned by a dead local PID can be recovered. Completed work releases the exact lease through compare-and-set.

## Unknown side effects

The checkpoint immediately before a tool invocation stores the tool side-effect class. If a process stops with a mutating tool in flight, startup marks the task `BLOCKED` with `RECONCILIATION_REQUIRED`. If a mutating tool returns a lost-response/timeout failure, the executor also blocks immediately without applying ordinary retry/replan policy. READ/NONE work retains safe checkpoint resume behavior.

## Other delta evidence

- Browser content remains untrusted data. Adversarial page instructions cannot add tools, approvals, internal-network access or WRITE capability; unsolicited pseudo/native tool calls fail.
- Each physical inference request has a durable STARTED and terminal attempt within one logical operation. Survival remains one remote request plus an eligible local Ollama fallback.
- SQLite crash coverage exercises concurrent local readers/writers, forced `SIGKILL`, restart and integrity checks. Effective pragmas are WAL, synchronous NORMAL (`1`), busy timeout 5000 ms and foreign keys enabled.

## Remaining P2 limitations

- The pinned browser egress buffers each response, bounded at 32 MiB; streaming media and WebSockets are not supported.
- Lease recovery is local-host/PID-aware. This release intentionally does not introduce distributed ownership infrastructure.
- Side-effect reconciliation records the required state but does not automate external reconciliation.
- Automatic vault unlock, automatic background task recovery, exact live quota counters, periodic remote probes, configurable aliases, cross-process onboarding JSON locks, browser-session serialization and automatic semantic/procedural memory consolidation remain deferred.
