# 0058. Exact Next.js 16.3.1 host stack

Status: accepted

## Context

The Publisher reference renderer previously required Next.js 16.2.12. The
Coherence migration baseline already uses Next.js 16.3.1 with older React and
React DOM patches and a TypeScript 5 range. Downgrading the established
publication framework would create an unnecessary migration risk, while
accepting two framework copies or suppressing peer errors would invalidate the
preview evidence.

Next.js 16.3.1 accepts the Publisher reference React 19.2.8 and React DOM 19.2.8
versions. Publisher's verified TypeScript 7.0.2 toolchain remains compatible.
The consuming root must continue to own the exact Nano ID, PostCSS, and Sharp
security overrides because dependency package overrides do not propagate.

## Decision

The official Next renderer and reference host require this exact stack:

- Next.js 16.3.1
- React 19.2.8
- React DOM 19.2.8
- TypeScript 7.0.2
- Nano ID 3.3.18 beneath Next.js
- PostCSS 8.5.24 beneath Next.js
- Sharp 0.35.3 beneath Next.js

`PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES`, package metadata, the workspace
lockfile, the private Supabase adapter peer, author templates, consumer tests,
and notices all carry the same identity. The packed host must resolve one copy,
reinstall from its frozen lockfile without network access, report zero
production vulnerabilities, build the real application, optimize a real image,
hydrate in Chrome, and preserve its source bytes.

The host contract advances from 0.15.0 to 0.16.0 because Next.js 16.3.1 writes
both generated route and root parameter declaration imports into
`next-env.d.ts`. The renderer owns that exact checked file so production builds
do not mutate author source.

This decision supersedes only the Next.js 16.2.12 pin in ADR 0009. It does not
change the renderer API, host contract version, React versions, TypeScript
version, or supported Node.js major lines.

## Consequences

Publisher validates the framework upgrade before any Coherence dependency
change. Coherence can then retain Next.js 16.3.1 and adopt the exact Publisher
React, React DOM, TypeScript, and override identities in a separate reviewed
migration unit.

The existing Vercel preview path may select a supported Node.js 22 range rather
than an exact patch. Local and CI evidence still use Node.js 22.12.0 and npm
10.9.0 exactly, and preview evidence must record the versions actually supplied
by the platform.
