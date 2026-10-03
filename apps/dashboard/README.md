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

- `LocalDashboardDataSource` (default): reads the existing SQLite database in **read-only** mode. Current integration covers ledger summaries, persistent memories and audit events. It does not import Runtime, Memory Engine, Provider Runtime or Model Router internals.
- `MockDashboardDataSource`: opt-in development fixture (`BEYONDER_DASHBOARD_SOURCE=mock`). Every page displays a **DEMO DATA** marker.
- `EmptyDashboardDataSource`: explicit no-data mode (`BEYONDER_DASHBOARD_SOURCE=empty`) for empty-state validation.

`BEYONDER_DB_PATH` follows the runtime's existing DB path contract. Relative paths are resolved from the monorepo root.

## Security boundary

The dashboard is read-only. It does not expose vault contents, cookies, passwords, tokens, API keys or environment variables. Audit details, memory text, sources and keywords pass through dashboard redaction before rendering.

No wallet, payment, x402, unrestricted browser/shell, self-modification or multi-agent capability is implemented here.

## Future integration points

| Runtime area | Dashboard adapter target |
| --- | --- |
| Memory Engine | `getMemories()` + working-memory adapter |
| Adaptive Router | `ModelDecisionView` / `ModelDecisionInspector` |
| BIB | `ModelView.capabilities` and benchmark availability |
| Economy | quota, runway and shadow-spend fields |
| Provider Runtime | `getProviders()` health/latency/quota telemetry |
| Task runtime | `getTasks()` classification → outcome timeline |
| Audit | already connected to local SQLite event stream |

The UI types are intentionally dashboard-owned so parallel runtime branches can evolve without forcing fragile imports into the web application.
