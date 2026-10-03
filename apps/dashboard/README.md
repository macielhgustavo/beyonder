# Beyonder Control Center

Local-first graphical control plane for Beyonder.

It reuses the useful parts of the old experimental dashboard:

- Next.js app setup
- `DashboardDataSource` boundary
- local SQLite read-only adapter
- redaction helpers
- audit, memory and router-decision views
- demo mode and tests

It intentionally discards the old read-only/developer-dashboard product shape. Normal operation now goes through human views and explicit commands:

- submit objective
- discover opportunities
- prepare application
- approve/reject action
- pause/resume runtime
- safe shutdown

The app binds to `127.0.0.1` and command endpoints reject non-local or cross-origin requests.

```bash
pnpm control-center
pnpm control-center:build
pnpm control-center:test
pnpm control-center:smoke
pnpm control-center:install-launcher
```

Normal use should start from Applications -> Beyonder after installing the launcher.
