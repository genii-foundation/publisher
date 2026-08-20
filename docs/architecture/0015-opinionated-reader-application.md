# 0015. Opinionated reader application and parity boundary

Status: accepted

## Context

GENII Publisher was approved as a complete, opinionated publishing application.
Its first renderer proved server rendering, route ownership, attribution, themes,
and thin host integration. It did not provide the ordinary client features of a
modern reading application.

The first Coherence migration audit classified progress, bookmarks, search,
reader settings, offline access, and narration playback as host retainable. That
classification answered a narrow migration question: a thin host can keep those
files beside generated engine files. It answered the product question wrongly.
If every publication must already own those features, Publisher is a rendering
library with excellent paperwork, not the application that was approved.

The Coherence Reader kept evolving after the first extraction snapshot. Its
current generic behavior includes continuity aware progress, bookmarks that can
survive passage revisions, bounded bookmark collections, reading preferences,
adjustable focus, text search, atomic offline publication packages, narration
playback across navigation, and optional cross device synchronization. The
migration cannot call those features preserved merely because the old host can
keep running them.

## Decision

### The official renderer supplies a complete default reader

The official renderer must ship a coherent default interface for:

- publication, collection, work, section, and hierarchy navigation
- text search over the public reader artifact
- local reading progress and one canonical progress percentage
- durable bookmarks, notes, revision relocation, and bounded collection tools
- font, color, motion, highlight, and focus preferences
- atomic offline publication packages with explicit version activation
- narration playback, voice choice, timing highlights, and offline audio
- optional opt in synchronization with a local fallback
- accessible keyboard, focus, empty, confirmation, and reduced motion states
- persistent GENII Publisher attribution

Server rendered manuscript text remains usable without JavaScript. Client
features are progressive enhancement and may not become a condition for reading.

### Engine protocols and renderer interfaces remain separate

The framework neutral Reader package owns pure state, identity, merge, search,
relocation, and offline planning contracts. It has no DOM, storage, network,
clock, random, React, Next.js, Supabase, or service worker authority.

The official renderer owns the default components, browser adapters, service
worker integration, and accessible interaction design. It receives only the
minimum page model needed by each client feature. The complete reader envelope
remains server only.

Client data is projected into capability-specific artifacts. Search, bookmarks,
outline, breadcrumbs, narration, and offline support do not force every page to
download every other feature's data. Browser adapters load those artifacts when
their surface opens and share one publication-scoped reactive store for atomic
updates and cross-tab notification.

Provider packages own optional remote persistence and privileged operations.
The reference Supabase package remains one provider, not a requirement for a
publication or a special case inside the Reader package.

Author repositories own content, publication identity, theme selection,
extension selection, provider configuration, credentials, editorial tooling,
publication checkpoints, provider edge continuity, and deployment.

### Local state is the default authority

Progress, bookmarks, and preferences use publication scoped keys. Storage
documents are versioned, bounded, sanitized, deterministic, and safe against
prototype shaped keys and future timestamps. A schema version newer than the
installed engine is refused rather than partially interpreted.

Progress follows declared continuity identities and groups. Percent, time,
scroll, audio, and counters merge monotonically. A content hash change preserves
history but marks the section updated until the current revision is read.

Bookmark deletion uses absorbing tombstones for synchronization. A bookmark
anchors to exact reader identities and content evidence. Relocation may return an
ambiguous result and never chooses a candidate merely because it appears first.

Remote synchronization is optional, explicitly enabled, and unable to disable
local reading. Declining consent, missing configuration, provider failure, or a
signed out session leaves the local application fully functional.

Remote rows are scoped by both publication and user identity. A provider may
serve several publications without allowing one publication's state to overwrite
another's merely because the same person reads both.

### Default features are replaceable through supported slots

A publication may replace visual components, provide a theme, add extensions,
or disable an optional capability through explicit renderer configuration. An
override receives validated plain data or a narrow capability interface. It does
not receive the server reader envelope, route authority, credentials, or control
of required attribution.

The default implementation remains available when no override is supplied. A
thin host does not copy the default components merely to customize them.

### Synchronization routes are part of the host contract

The reference host contract includes the authentication callback and account
deletion route surfaces unconditionally. When synchronization is absent, they
fail closed without exposing a live endpoint or provider detail. When configured,
they delegate through a validated provider interface.

This resolves the initialization deadlock recorded by ADR 0014. Initialization
does not need a publication in order to create a stable application contract.
Enabling synchronization later changes configuration and artifacts, not the
public route shape or checked in host integration.

### Narration includes a default player, not an embedded catalog

ADR 0014 remains correct that the narration catalog and timing sidecars stay out
of the reader envelope. The official renderer now owns a default client that
loads those artifacts lazily, derives word anchors from rendered text, preserves
playback across navigation, and can include immutable audio in an offline
package. Publications may replace that client through a supported slot.

The engine validates publication evidence that a changed narrated section has a
matching reviewed audio version before a release claims narration parity. Audio
generation providers and immutable publication checkpoints remain author owned.
Narration input identity is derived from the spoken title and normalized spoken
body, not Markdown punctuation or presentation markup. The engine treats provider
objects and timing evidence as immutable bytes and does not invent provider
verification it did not perform.

### Parity is a checked inventory

The Coherence migration ledger covers every current generic Reader capability,
not only narration and synchronization. Every entry records its target owner,
implementation status, engine evidence, and Coherence observation ref. A planned
or blocked capability stays visible and cannot be described as preserved.

The ledger is refreshed against the exact Coherence acceptance ref before each
migration preview. Coherence specific art, language, editorial administration,
continuity records, audio checkpoints, and provider credentials remain outside
generic parity.

### Delivery is incremental but the release claim is not

Reader state primitives, default components, offline packaging, narration,
provider routes, and migration adoption may land as separate reviewed changes.
No prerelease may claim complete Coherence Reader parity until the ledger has no
unowned or merely planned generic capability and the packed reference host proves
the default behavior in a browser.

## Consequences

The official application grows beyond a server renderer. That is deliberate.
Package boundaries keep its pure state core reusable and keep framework code out
of the publication protocol.

The Next host contract must advance when new checked in route files or integration
inputs land. Existing hosts receive those changes through the governed upgrade
planner and reviewable migration patches.

The earlier claim that nine host retained capabilities were already preserved is
superseded. Those implementations may remain in Coherence during migration, but
they are temporary compatibility code until the default engine equivalents pass
acceptance or Coherence deliberately selects an override.

ADR 0014 is superseded only where it says playback, word interaction, voice
selection, and offline caching remain outside the engine application. Its
artifact boundaries, lazy catalog design, provider separation, and privacy rules
remain in force.

ADR 0014's existing `audioVersionId` remains opaque for catalog compatibility.
The spoken-input identity required by the publication guard is a separate engine
value. Publisher does not reinterpret legacy provider identifiers or force an
existing catalog to adopt a new provider naming scheme.

Multi section compilation remains a prerequisite for Coherence acceptance. A
perfect bookmark system cannot bookmark chapters the build never emitted, which
is the sort of joke only a compiler would tell.
