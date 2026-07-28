# ADR 0008: Extension capability grants

- Status: Accepted
- Date: 2026-07-28

## Context

GENII Publisher permits an author repository to install extension packages without turning every installed package export into a supported engine interface. The publication manifest already declares extension identity, order, package, and configuration. It does not yet state which engine surfaces an author permits the extension to use.

An implicit permission model would let package configuration, installed metadata, or host conventions widen an extension's authority without a visible source change. An open string vocabulary would make compatibility unverifiable. Treating permission metadata as a JavaScript sandbox would make a security promise the engine cannot keep.

This decision refines the extension boundaries in ADR 0001, ADR 0005, and ADR 0007.

## Decision

Every extension declaration requires a nonempty ordered `capabilities` array. Members are unique. The initial vocabulary is closed:

- `content.project` permits a framework-neutral build-time projector to consume validated content and emit separate artifacts. It cannot mutate the canonical content envelope.
- `renderer.slot` permits server-rendered output only in slots declared by a renderer contract.
- `renderer.client` permits explicitly authorized client code and browser data.
- `host.route` permits declarative public page routes subject to canonical route and collision validation.
- `host.handler` permits server request handlers through host-owned factories and validation.

Each grant is independent. One grant never implies another. There is no wildcard grant.

This protocol slice defines grants but does not implement any invocation surface. A future renderer or host package must define and validate its own supported interface before it can consume a grant.

Manifest extension order governs extension resolution. Capability order is the author's exact reviewed serialization and participates in identity. It does not establish precedence between capabilities.

The host supplies one resolved extension input for every manifest declaration in the same extension order. Each resolved input repeats the manifest's capability grants exactly and in the same order. Missing, extra, reordered, mismatched, unknown, or duplicate grants fail validation.

The compiler retains the exact ordered grants on `CompiledExtension`. They participate in the content hash and build ID. Package exports, configuration, payloads, or installed package metadata cannot widen the grants recorded by the manifest.

The reader projection omits extension identities, packages, versions, configuration, capability grants, source evidence, and payloads. A future client extension receives only a separate browser-safe projection authorized for that extension and audience.

Capability grants govern engine invocation and data supply. They do not sandbox package installation, module import, Node.js execution, filesystem access, network access, or process authority. Package trust, installation review, and process isolation remain separate host responsibilities.

Adding a capability name or changing a capability's meaning is a protocol compatibility change.

## Consequences

- Every enabled extension requires an explicit author-reviewed grant list.
- Resolution cannot silently add or reorder authority.
- Content identity changes when the ordered grant list changes.
- Framework-neutral content, renderer behavior, client code, public routes, and request handlers remain separate permissions.
- Browser reader data remains free of extension authority and authoring evidence.
- Future hosts need package compatibility checks in addition to this manifest and compiler contract.

## Rejected alternatives

### Infer authority from package exports

An installed package can expose many entry points. Export presence is not author consent and does not define a stable engine contract.

### Accept arbitrary capability strings

Unknown strings would prevent reliable compatibility checks and turn spelling mistakes into ambiguous policy.

### Treat grants as an execution sandbox

In-process JavaScript already has the authority of its host process. Invocation grants cannot contain malicious package code after installation or import.
