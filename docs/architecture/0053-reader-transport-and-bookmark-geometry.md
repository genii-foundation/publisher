# ADR 0053: Reader transport and bookmark geometry

- Status: Accepted
- Date: 2026-08-19

## Context

The current Coherence Reader added dedicated audiobook transport controls,
isolated stale playback callbacks on mobile Safari, and corrected passage
highlight anchoring. Publisher already owned one root-level audio element and
portable bookmark ranges, but its default controls lacked explicit 15-second
jumps. A rejected play promise could also report failure after a newer playback
request had taken ownership of the player.

Bookmark selection and margin markers previously counted every descendant text
node. Renderer-owned heading controls and transient status text could therefore
alter portable offsets or marker geometry even though that text was not part of
the manuscript.

## Decision

The official renderer retains one audio element in its root narration provider.
Clip changes, queue movement, and route navigation reuse that element. The
default Listen panel includes labeled 15-second back and forward controls in
addition to previous, play or pause, and next. The seek control exposes its
formatted position and duration to assistive technology.

Every play request receives a monotonically increasing attempt identity. A
resolved or rejected promise may update state only when its identity and audio
element still match the current attempt. Pausing, changing source, and unmounting
invalidate earlier attempts before acting.

The renderer marks interface descendants that are not manuscript prose with one
private transient UI attribute. Passage selection and bookmark markers use one
shared DOM text coordinate implementation that excludes those descendants.
Range geometry is measured from accepted text nodes, including multi-block
ranges. Marker positions use document scroll coordinates without a viewport top
clamp.

## Evidence

The clean packed-host Chrome proof requires all five transport controls, bounded
15-second movement, one reused audio node across clip and route changes, timed
word playback, and mobile viewport containment. It also injects large transient
renderer text into a bookmarked block, waits for measurement, and requires the
marker's top and height to remain unchanged.

This decision's transport and geometry audit used Coherence
`fe2a1c8c8b6e4df21665afbf6609cf6bef782415`. The current parity authority lives
in the ledger and migration readiness record, which may advance without rewriting
this historical decision.

## Consequences

Mobile playback keeps the browser-authorized media object while still isolating
old asynchronous failures. Readers receive familiar fixed-distance transport
without losing section queue controls.

Renderer controls can remain adjacent to headings and passages without becoming
bookmark content. New transient controls inside a canonical manuscript block
must carry the shared attribute.

## Rejected alternatives

- Replace the audio element when a clip changes. Mobile browsers can treat the
  replacement as a new unauthorized playback target.
- Let every play promise update shared error state. An older rejection can stop
  or misreport a newer request.
- Remove heading controls before every bookmark operation. That duplicates DOM
  policy and risks mutating visible interface state.
- Treat all descendant text as manuscript prose. Portable offsets would depend
  on renderer implementation details.
