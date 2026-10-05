# Beyonder Control Center — Design Memory

## Product identity

Beyonder is not a generic AI dashboard. The Control Center is a **local-first operational instrument** for supervising an autonomous runtime: define an objective, understand what is happening, intervene when human approval is required, and verify outcomes.

The interface should feel closer to a serious control plane / infrastructure console than to a SaaS marketing product.

## Visual direction

- Dark, restrained, technical and calm.
- Dense enough for real operational use, but never visually noisy.
- Strong information hierarchy before decoration.
- Graphite / near-black surfaces with subtle separation by borders and spacing.
- Green is a **signal color**, not a decorative brand wash.
- Amber, red and muted blue are reserved for semantic states.
- Sans-serif for human reading; monospace for system state, identifiers, metrics and operational labels.
- Repeated surfaces should read as one continuous instrument, not a collection of floating cards.
- Small radii, quiet borders, deliberate alignment and compact controls.

## Human-first hierarchy

1. Global runtime state.
2. Current objective / command surface.
3. Anything that needs a human decision.
4. Active work and verified outcomes.
5. Economy / resource state.
6. Audit and technical details.

Technical IDs, raw payloads and architecture details remain hidden unless Developer Mode is enabled.

## Interaction principles

- Every screen must make the next useful action obvious.
- Avoid requiring terminal commands for normal operation.
- Use human language first; technical detail is progressive disclosure.
- Risky actions are explicit and visually separated from ordinary actions.
- Status must be understandable without relying only on color.
- Keyboard access and visible focus states are required.
- Respect reduced-motion preferences.

## Responsive principles

### Desktop

- Persistent left navigation.
- Sticky runtime status rail.
- High information density with predictable alignment.
- Avoid unnecessary vertical expansion.

### Mobile

- Navigation becomes a compact horizontal control strip.
- Runtime state remains visible.
- No page-level horizontal overflow.
- Dense tables / step flows may scroll inside their own containers only.
- Primary actions remain reachable without precision tapping.
- Content becomes single-column before it becomes cramped.

## Anti-patterns

Do not introduce these unless there is a concrete product reason:

- purple / blue AI gradients;
- neon cyberpunk or crypto aesthetics;
- glassmorphism cards;
- floating blobs, glow effects or decorative particles;
- hero + three cards + CTA SaaS templates;
- excessive card grids;
- huge empty whitespace that reduces operational density;
- fake analytics or decorative charts;
- generic AI copy such as “unlock the power of…”;
- icons or illustrations that do not encode useful meaning;
- gratuitous animation;
- visual effects that make local runtime state look less trustworthy.

## Current design tokens

The source of truth is `app/globals.css`.

- Background: near-black graphite.
- Surfaces: progressively lighter graphite layers.
- Signal / healthy: muted green.
- Warning: muted amber.
- Failure: muted red.
- Informational / working: muted blue.
- Borders do most of the structural work; shadows should be exceptional.

## Visual QA contract

A visual change is not complete until:

- production build passes;
- desktop viewport has no unintended document overflow;
- mobile viewport has no unintended document overflow;
- active navigation is visible;
- command surface and primary action remain usable;
- Home, Work and Opportunity views remain legible in screenshots;
- browser runtime reports no page errors;
- screenshots are retained as CI artifacts when the browser smoke runs.
