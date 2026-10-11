# Research Sources

This project is inspired by public autonomous-agent and agent-payment projects, but v0.1 does not copy third-party code.

For the pinned implementation-level comparison of provider aggregation, routing,
agent operation and release-candidate gaps, see
[Release candidate GAP MATRIX](../architecture/release-candidate-gap-matrix.md).
That audit checked four MIT license files and implements patterns independently;
it does not import reference code or their financial/autonomous-action scope.

## License Notes

| Project | Public source checked | License signal | Current use |
| --- | --- | --- | --- |
| Conway Automaton | `https://github.com/Conway-Research/automaton` and public project descriptions | Public descriptions reference MIT; confirm in repo before copying code | Architectural inspiration: survival pressure, heartbeat, memory, economic runtime |
| Forage economic agent | `https://github.com/Nerfed-Lab/forage` | MIT in public repository summary | Conceptual inspiration: seed capital, agent survival, revenue pressure |
| Coinbase AgentKit | `https://github.com/coinbase/agentkit` | Apache-2.0 in repository README/license | Future adapter inspiration for wallets; not used in v0.1 |
| x402 | `https://github.com/BofAI/x402` and Coinbase x402 materials | MIT in public repository summary | Future payment protocol research; not used in v0.1 |

## Policy

Before copying or adapting code from any source:

1. Read the repository license file directly.
2. Preserve required copyright and license notices.
3. Record the copied file, original URL, commit hash, license, and modifications here.
4. Prefer clean-room reimplementation when the idea is simple.

## Ideas Adopted in v0.1

- Survival-style economic state machine.
- Agent loop that treats cost as a first-class signal.
- Ledger-first accounting before wallet integration.
- Provider abstraction so local/free models can do most work.
- Tool interfaces that exist early but are disabled by default.
