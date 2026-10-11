# Beyonder Control Center — Design Memory

## Status

Created for `feat/v05-premium-ui` after repository inspection. No prior `DESIGN-MEMORY` artifact was found in the repository.

## Product thesis

Beyonder Control Center is an **operator console**, not a metric dashboard. The interface should answer, in order:

1. What did I ask?
2. What is Beyonder doing right now?
3. Did it finish?
4. What is the result?
5. What evidence supports that result?
6. Does it need me?
7. What happened technically, if I choose to inspect it?

The UI must never manufacture progress, confidence, health, cost, source state, or tool activity. `UNKNOWN` is a first-class truthful state.

## Visual direction

- Dark-first, near-neutral charcoal/black foundation rather than blue/purple AI surfaces.
- Subtle elevation through value changes, not glassmorphism, glow, or large shadows.
- 1px borders with tightly controlled contrast.
- One primary trust accent (muted mint/green). Amber, red and blue are semantic-only.
- Dense operational lists; generous breathing room is reserved for goal input, active work and final results.
- Typography should feel editorial and technical: strong human-readable headings, calm body text, monospaced microcopy only where it encodes machine state/IDs/measurements.
- Radius stays restrained. Avoid a page made of interchangeable floating cards.
- Motion communicates state transitions only. No decorative animation.

## Information architecture

Keep the semantic navigation domains intact:

- Home / Command
- Missions
- Opportunities
- Work
- Decisions
- Resources
- Memory
- History
- Settings

Improve hierarchy within those domains rather than collapsing backend concepts together.

## Surface rules

### Home

Home is the command surface. Goal composer and active mission/result are visually dominant. Runtime health, recent activity and economy are secondary context. A user should be able to submit an objective and follow it through result/evidence without leaving Home.

### Missions

Mission list is scan-first, not card-gallery-first. Status, intervention need, objective/result preview, timing and evidence are readable in one pass. Technical execution fields remain progressively disclosed.

Mission detail is outcome-first: request → current state → result/failure → evidence → lifecycle → technical attempts.

### Opportunities

Opportunities are discoveries still being evaluated. The UI emphasizes source, reward, fit/feasibility, confidence, effort/cost, risk, deadline and approval/action readiness. Missing fields stay absent/unknown.

### Work

Work is economic lifecycle only: application → execution → deliverable → submission → settlement. It must not resemble ordinary missions.

### Decisions

Approvals must communicate exactly what will happen, where, scope, risk and whether action is pending/consumed/rejected. Destructive or external actions remain deliberate.

### Resources

Resources is operational capacity first, accounting second. Provider state, verification, runway/quota truth, latency/health truth and degraded/unavailable/unknown states lead. Cost truth remains separate and explicit.

### Memory / History / Settings

These are professional utility surfaces: compact, searchable/scannable in structure, low decoration, technical detail available on demand.

## Responsive behavior

Desktop is primary. Notebook reduces gutters before collapsing information. Tablet reflows detail panels into a single reading column. Mobile becomes a command-first vertical interface with horizontal navigation removed in favor of a compact navigation control; no merely-shrunken desktop tables/cards.

## Non-goals

- No cyberpunk agent room as the primary UI.
- No blue/purple AI gradient.
- No giant KPI typography.
- No fake live steps.
- No decorative agents/icons.
- No backend semantic changes for visual convenience.

## Optional Live Operations experiment

Only consider after the core product surfaces are excellent. It must be driven exclusively by persisted/observable runtime states and remain secondary/optional. If it does not improve comprehension, omit it.
