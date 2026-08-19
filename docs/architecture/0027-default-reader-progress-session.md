# 0027. Default Reader progress session

Status: accepted

## Context

The Reader package already represents bounded section openings, scroll depth,
active reading time, manual and automatic completion, content revisions, and
word-weighted progress. The official renderer previously used only scroll depth
and automatic completion. It also attached an opening event to every scroll
sample, so repeated scrolling could inflate a section's visit count.

The default application needs useful progress behavior without analytics,
accounts, remote authority, or a client-only manuscript.

## Decision

The official renderer records one opening for each hydrated section session.
Scroll samples update only monotonic completion and scroll depth. A return is
derived from every opening after the first, using the bounded open count already
owned by the framework-neutral progress document.

Active reading time accrues only while the document is visible and the reader
has interacted within the last 45 seconds. Pointer, keyboard, scroll, focus, and
visibility activity refresh the active window. Samples commit every five seconds
and cap any individual interval at ten seconds, so a suspended process or clock
jump cannot create a large false reading session. Each commit atomically adds its
elapsed time to the latest reactive progress snapshot.

The Reader rail exposes the current section's canonical status, percentage,
active reading time, visits, and derived returns. It offers a manual control to
mark the current content revision as read. Progress remains monotonic. The
interface does not offer a destructive reset disguised as an unread toggle.

## Consequences

Local reading now produces useful session evidence without an account. Remote
synchronization remains optional and transfers the same bounded progress
document when consent is granted.

The clean packed-host Chrome proof waits for active reading time, dispatches
repeated scroll events, and requires one visit in both storage and the rendered
progress panel. The same proof retains server-rendered manuscript text and a
mobile-safe Reader rail with six controls when synchronization is configured.

Heatmaps, recent-section lists, and recommendations remain a separate surface.
They require a broader publication progress projection and are not inferred from
the current section panel.
