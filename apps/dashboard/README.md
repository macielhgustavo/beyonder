# Beyonder Dashboard

Local, read-only control plane and observability UI for Beyonder.

## Run

From the repository root:

```bash
pnpm dashboard
# or
pnpm --filter @beyonder/dashboard dev
```

The server binds to `127.0.0.1` by default. It is not exposed publicly.

## Validation

```bash
pnpm dashboard:typecheck
pnpm dashboard:test
pnpm dashboard:build
```

CI uses `pnpm install --frozen-lockfile`, runs all three checks, boots the built dashboard locally and captures the demo-mode screenshots used for visual verification.

## Data sources

`DashboardDataSource` is the stability boundary between UI and runtime internals.

- `LocalDashboardDataSource` (default): reads the existing SQLite database in **read-only** mode. Current integration covers ledger summaries, persistent memories, audit events and Adaptive Router decision telemetry (`router.selected`, `router.candidate_scored`, `shadow_cost.calculated`). The dashboard reconstructs recent model decisions from those persisted events instead of importing router internals.
- `MockDashboardDataSource`: opt-in development fixture (`BEYONDER_DASHBOARD_SOURCE=mock`). Every page displays a **DEMO DATA** marker.
- `EmptyDashboardDataSource`: explicit no-data mode (`BEYONDER_DASHBOARD_SOURCE=empty`) for empty-state validation.

`BEYONDER_DB_PATH` follows the runtime's existing DB path contract. Relative paths are resolved from the monorepo root.

Database availability is not treated as a runtime heartbeat. Runtime health remains `UNKNOWN` until a stable health/heartbeat signal is exposed.

## Security boundary

The dashboard is read-only. It does not expose vault contents, cookies, passwords, tokens, API keys or environment variables. Audit details, memory text, sources and keywords pass through dashboard redaction before rendering.

No wallet, payment, x402, unrestricted browser/shell, self-modification or multi-agent capability is implemented here.

## Integration points

| Runtime area | Current state / dashboard adapter target |
| --- | --- |
| Memory Engine | persisted memory is connected through `getMemories()`; working-memory telemetry can be added behind the same contract |
| Adaptive Router | recent decisions are reconstructed from audit telemetry into `ModelDecisionView`; a future stable decision API can replace the audit adapter without UI changes |
| BIB | `ModelView.capabilities` and benchmark availability are ready; benchmark data is intentionally not implemented here |
| Economy | ledger is connected; quota, runway, current economic state and shadow-spend aggregates still need stable read signals |
| Provider Runtime | `getProviders()` is ready for health/latency/quota telemetry; no fragile provider-state imports are used |
| Task runtime | `getTasks()` is ready for classification → outcome timelines once task persistence has a stable read contract |
| Audit | connected to the local SQLite event stream with search, filters, limits and redaction |

The UI types are intentionally dashboard-owned so parallel runtime branches can evolve without forcing fragile imports into the web application.
