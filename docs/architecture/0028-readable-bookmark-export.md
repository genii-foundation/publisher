# 0028. Readable bookmark export

Status: accepted

## Context

Saved passages are private Reader data. A reader needs a complete, understandable
copy that does not require GENII Publisher, a provider account, or knowledge of
the internal bookmark schema.

Quotes and notes are reader-controlled text. Treating either as Markdown during
export would let ordinary note text resemble headings, links, or report
structure. The export also needs to omit synchronization tombstones while
preserving the selected text, note, saved time, and destination for every live
bookmark up to the supported collection limit.

## Decision

The framework-neutral Reader package produces a versioned UTF-8 plain-text
bookmark export. The caller supplies the publication title, explicit generation
time, and an optional validated HTTP or HTTPS origin. Every reader-controlled
line is indented beneath a fixed label. Destinations are plain text rather than
active markup.

The export sanitizes the complete bookmark document through the existing
publication-scoped context, sorts live bookmarks through the canonical query
order, omits tombstones, and ends with one newline. Its filename is derived from
the validated publication ID.

The official renderer offers text search over selected text, notes, and context.
It creates the export only after a reader chooses the download control, then
uses a short-lived browser Blob URL. No bookmark data is sent to a server.

## Consequences

Readers can search and download their saved passages without enabling
synchronization. The export is readable in any text editor and retains useful
destinations when a publication origin is available.

Focused engine tests cover multiline reader text, misleading label-shaped note
text, tombstone omission, absolute destinations, filename stability, invalid
origins, and the trailing newline. The clean packed-host Chrome proof queries a
bookmark written by a peer tab, renders the empty search state, invokes the real
download control, and inspects the generated Blob text.

Virtualized thousand-item rendering, selection capture, margin markers, and
confirmed deletion controls remain separate renderer capabilities.
