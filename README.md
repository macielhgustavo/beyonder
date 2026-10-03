# Beyonder

Beyonder is an autonomous economic agent runtime with a zero-cost-first compute acquisition layer.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test

pnpm beyonder status
pnpm beyonder economy
pnpm beyonder run "Verify the runtime without side effects" --steps 1

pnpm beyonder providers autopilot
pnpm beyonder providers resume
pnpm beyonder providers inventory
pnpm beyonder providers discover
```

Provider shortcuts are also available:

```bash
pnpm providers:autopilot
pnpm providers:resume
pnpm providers:inventory
pnpm providers:discover
pnpm providers:status
```

## Safety Defaults

Shell, browser, and filesystem tools are disabled by default. The first integrated task uses a safe in-process tool that records the objective and produces no external side effects.

Secrets, cookies, sessions, local databases, `.env` files, and `.providers-vault/` are ignored by Git.
