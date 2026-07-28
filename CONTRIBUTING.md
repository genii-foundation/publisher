# Contributing

GENII Publisher welcomes focused contributions that preserve the project boundaries in `AGENTS.md` and the accepted architecture decisions.

## Before changing code

1. Open or identify an issue that states the user-facing or protocol problem.
2. Confirm whether the change belongs in the generic engine, an optional adapter, an editorial profile package, or an author repository.
3. Keep each pull request narrow enough to validate and reverse independently.

## Development

Use the Node.js version in `.nvmrc`, then install the exact lockfile:

```bash
npm ci
npm run validate
```

New protocol behavior needs a generic test and at least one neutral fixture. Package changes must be tested from the packed package in a clean consumer, not only from workspace links.

## Licensing

Contributions to covered code are made under CPAL 1.0. Preserve the source notices, attribution terms, network source availability, and change documentation required by the license.

Append a dated summary to `CHANGES.md` when modifying covered code. Disclose any known third-party intellectual property requirement in `LEGAL`.

Do not contribute manuscripts, private editorial evidence, credentials, deployment identifiers, or assets unless their inclusion and license are explicit.

## Manuscript safety

Compiler, migration, preview, test, and validation commands must not revise manuscript prose. Editorial assistance may produce proposed patches or review artifacts for human approval, but it may not apply prose changes as part of an engine upgrade.
