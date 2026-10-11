# ADR 0045: Route-preserving narration intent

Status: accepted

## Context

A reader may choose a narrated section from a different route. Plain link
navigation either destroys the current media element or leaves playback startup
to the destination page after the browser's user activation has expired.
Publication code should not need to know how the official renderer keeps its
player alive across a framework navigation.

The browser event boundary is untrusted. A script can fabricate a publication,
section, or destination. Consuming a plausible destination without checking the
current Reader build could start one recording while opening unrelated text.

## Decision

The framework-neutral Reader narration subpath owns a closed navigation intent.
It contains one publication identity, section identity, and root-relative
destination. Its parser rejects stale publication identity, unknown fields,
unsafe records, unstable identities, network-path references, controls,
whitespace, backslashes, and oversized values. It returns a detached immutable
record and has no event, DOM, media, network, storage, clock, or navigation
authority.

The official renderer exposes one cancelable browser event helper. A consumer
offers an intent before allowing its ordinary link behavior. The mounted player
consumes the request only when narration and the progress catalog are ready, the
selected voice has the requested section, and the section and destination match
one exact entry in the build-bound progress catalog. Otherwise it leaves the
event unhandled and the link fallback remains in charge.

A consumed request opens Listen, selects the requested clip, starts or resumes
the persistent media element. A root-layout provider owns that element and the
open panel while routed Reader rails control it through context. The caller's
ordinary Next.js link then performs the route transition. This is the same
operation for the current route and a different section route. Modifier keys
retain normal browser link behavior.

## Consequences

Playback intent survives fragment updates and framework route changes without
placing publication paths in the player. A fabricated event cannot select an
external URL, cross publication boundaries, redirect a section, or play a clip
that the current voice does not carry.

The helper returns whether a mounted player consumed the request. The framework
link remains responsible for navigation in either case. A cold player does not
claim autoplay it cannot guarantee. Opening Listen first loads the two
identity-bound artifacts and makes later requests eligible.

The packed host proof requires an invalid destination to remain unhandled. It
also requires playback, panel state, section title, and canonical destination to
survive both current-section and different-section navigation.
