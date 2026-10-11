# 0040. Lazy narration timings over existing text

Status: accepted

## Context

The default narration player can play a complete voice queue without timing
data. Some narration catalogs also declare a word timing sidecar beside a clip.
That sidecar is untrusted browser input. It can be stale, oversized, malformed,
or attached to the wrong section, audio version, voice, or spoken text.

The manuscript already owns the accessible text. Timed narration cannot add a
second hidden or visible copy merely to obtain word anchors. It also cannot put
large timing arrays in the Reader artifact or fetch them before playback.

## Decision

The Reader narration subpath defines one closed spoken text profile. It trims
the section title, normalizes body whitespace from ordered Reader blocks, omits
a structural first heading that repeats the title, and joins title and body with
two newline characters. Timing producers and renderers use this profile only
for identity and offsets. The Reader artifact does not gain narration data.

The same subpath owns a strict timing parser. It requires the exact declared
serialized byte size and exact section, audio version, voice, and text character
count. It bounds input and word counts, rejects unknown fields, validates
monotonic character and time ranges, verifies summary counts, requires at least
60 percent exact word alignment, and permits at most 12 adjacent interpolated
words. Accepted documents and word records are immutable.

The timing URL is derived by replacing the clip extension with
`.timings.json`. A clip without `timingsByteSize` has no sidecar.

The default renderer marks words already present in server rendered manuscript
markup. These spans preserve the same text occurrence used by reading,
selection, bookmarks, and assistive technology. Section markup carries only the
spoken text character count and title and body word counts. It does not carry
the spoken text or timing array.

Opening Listen does not fetch a timing sidecar. The persistent media element
starts from the trusted play gesture first. Its play event then starts one
bounded timing request with a 1.5 second timeout. A document is used only when
its body word count also matches the rendered word anchors. The active timing
selects an existing body word by index. Pause, clip change, and component
cleanup remove the visual state.

The packed host proof publishes a real timing sidecar beside its real WAV file.
Chrome verifies no timing request before playback, one request after playback,
an active existing word, and byte identical manuscript text before and after
highlighting.

## Consequences

Timed highlighting is an optional enhancement. A missing, slow, malformed, or
stale sidecar cannot delay playback, replace manuscript text, or prevent
reading. A page that does not render the playing section does not fetch or
highlight that section's timing data.

The author narration pipeline remains responsible for recognizer alignment and
for writing a sidecar that matches this spoken text profile. Publisher validates
and consumes the result but does not run a recognizer.

Route preserving playback intent, word initiated playback, offline audio, and
publication guards remain separate capabilities.
