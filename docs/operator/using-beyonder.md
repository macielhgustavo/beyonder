# Using Beyonder

1. Open "Beyonder" from Applications.
2. Check the status at the top of the Control Center.
3. Type what you want Beyonder to do.
4. Watch progress in Trabalhos and Historico.
5. Review external actions in Decisoes.
6. Approve only the action you understand.
7. Pause Beyonder whenever you want it to stop starting new work.

Closing the browser does not necessarily stop the runtime. Use Settings -> Safe shutdown when you want Beyonder to stop cleanly.

## Fedora/KDE Launcher

Install the user-level launcher without root:

```bash
pnpm control-center:install-launcher
```

Then open Applications -> Beyonder. The launcher starts the local Control Center on `127.0.0.1`, reuses an existing instance when healthy, and opens the browser.

## Developer / CLI

The terminal remains available for development:

```bash
pnpm control-center
pnpm control-center:build
pnpm control-center:test
pnpm control-center:smoke
```

Normal operation should not require copying IDs, opening SQLite, or running CLI commands.
