# ADR 0001: Product and repository boundary

- Status: Accepted
- Date: 2026-07-27

## Context

The publishing technology now embedded in The Coherence Thesis needs to serve unrelated publications without importing Coherence content, editorial policy, branding, or repository assumptions. Authors also need a complete product, not a loose toolkit that makes each publication reconstruct navigation, accessibility, reading behavior, metadata, audio, and deployment from scratch.

An engine hidden inside each author repository would drift through copied code. A generated host that is replaced on every upgrade would erase deliberate author customizations. A closed theme system would make the default product easy to recognize and impossible to inhabit.

## Decision

GENII Publisher will live in its own public repository and package namespace. It is an opinionated publishing application with supported customization boundaries.

Each publication will remain a thin host repository. The host owns:

- manuscript and publication metadata
- assets and publication identity
- editorial configuration and selected editorial packages
- public URL continuity rules
- deployment configuration and secrets
- the exact GENII Publisher version it has accepted
- its complete Git history

The host will contain small, checked-in application entry points. Those entry points construct a publication runtime from host configuration and versioned engine packages. They are stable adapter seams, not generated copies of the engine.

GENII Publisher will provide:

- a complete default reader and publishing workflow
- an official theme with documented design tokens and component boundaries
- supported theme replacement and augmentation
- typed extension points for publication-specific behavior
- host route adapters for framework-specific integration
- initialization, validation, migration, build, and preview commands

Themes may override presentation without forking reading semantics. Extensions may add capabilities and routes through declared interfaces. A consuming repository may replace the official theme, provide additional components, and register publication-specific extensions. Internal engine modules are not extension contracts merely because JavaScript makes them importable.

The engine repository will never contain Coherence manuscripts, voice cards, continuity records, publication secrets, or Coherence-specific brand assets.

## Rationale

The separate repository gives the engine an independent release history, issue tracker, compatibility policy, and contributor surface. The thin host keeps authors in custody of their work and deployment. Checked-in adapters let substantial engine upgrades evolve the host interface through reviewable migrations without regenerating the author repository.

Opinionated defaults make a first publication coherent and complete. Explicit theme and extension contracts prevent that opinion from becoming a tasteful prison.

## Consequences

- Engine releases and publication releases are separate events.
- Installing an engine version does not publish a manuscript.
- The host may carry a small compatibility patch when an upgrade changes its adapter interface.
- Extensions and themes must target documented contracts and declare compatible engine versions.
- Engine package tests must prove that the public contracts work from an installed package, not only inside the engine workspace.
- Coherence-only governance and editorial skills remain in the Coherence repository.

## Non-goals

- GENII Publisher will not become a generic site generator for every web product.
- Engine migrations will not rewrite manuscript prose.
- The default theme will not be the only supported visual identity.
