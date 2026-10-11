# 0033. Optional bookmark capture note

Status: accepted

## Context

ADR 0032 established canonical passage selection and immediate local bookmark
capture. The bookmark document already supports a bounded optional note, and the
default Reader can search, display, and export that note. Requiring a reader to
save first and locate the bookmark again makes the most useful annotation moment
needlessly indirect.

The note interface must not invalidate the canonical passage captured before it
opens. It must also remain usable with a keyboard and fit inside supported mobile
viewports without sending private text to a server.

## Decision

The passage save action opens a focused, viewport-contained editor with an
optional note field. The note is limited to 280 UTF-16 code units, trimmed before
storage, and omitted from the bookmark when blank. Cancel returns to the passage
save action without creating a bookmark.

While the editor owns focus, Reader selection listeners preserve the already
validated passage instead of recapturing document selection after textarea input.
The editor retains ordinary pointer and keyboard editing behavior. Saving uses
the same atomic local document update and engagement event established by ADR
0032, then clears both the browser selection and the transient editor state.

## Consequences

Readers can capture a portable passage and its private note in one operation. The
note immediately participates in existing bookmark query, export, reactive
cross-tab state, deletion, and optional synchronization behavior.

The clean packed-host Chrome proof opens the editor on a mobile viewport, checks
focus and complete viewport containment, dispatches a representative key event,
requires the editor to retain the note, saves it, and compares the persisted
quote, note, and start block ID with the real DOM selection.

Margin markers and virtualized collection rendering remain separate
capabilities.
