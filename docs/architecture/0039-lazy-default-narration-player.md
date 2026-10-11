# 0039. Lazy default narration player

Status: accepted

## Context

Publisher already materializes a narration envelope separately from the Reader
artifact. It binds voices and clips to one publication and Reader build without
making every page download hundreds of clip records. The official renderer did
not consume that envelope, so publications still needed their own player for
basic listening.

The browser boundary is untrusted. A fetched envelope can be stale, oversized,
malformed, or point at an unsafe URL even when the build-time copy was valid.
Voice and speed choices are private reader preferences. They must remain useful
without an account and cannot widen the publication protocol.

## Decision

The framework-neutral Reader package owns a browser-safe narration projection.
Its parser bounds serialized bytes, voices, clips, nested adapter configuration,
identities, URLs, sizes, durations, and counts. It enforces exact known fields,
duplicate coverage rules, declared statistics, and an exact publication and
Reader build match. It returns only immutable playback data.

The same subpath owns a small publication-scoped preference document for voice
and playback rate. It has a versioned exact shape and a closed rate vocabulary.
Storage, network, DOM, media, and clock authority stay outside the package.

The official renderer mounts one persistent media element beside the Reader
rail. Opening Listen fetches the narration envelope once. Closing the panel does
not destroy active playback. The default controls provide play, pause, seek,
bounded rate, voice selection, previous and next movement, and automatic queue
continuation. The selected voice retains the current section when possible.

The player joins narration section identities to the existing lazy progress
catalog for human titles and canonical section destinations. Narration remains
usable with stable section identifiers if that secondary catalog cannot load.
Exact declared duration, queue position, timed-clip coverage, and unnarrated
coverage are shown without fabricating estimates for clips that declare no
duration.

The packed host proof supplies a real WAV file and two voices. Chrome verifies
that narration is not requested before Listen opens, playback advances, queue
movement changes the recording, the panel stays within the mobile viewport, and
voice and speed preferences persist.

## Consequences

The narration envelope remains a separate lazy artifact. It does not enter the
Reader envelope or the server-rendered manuscript payload. A publication with no
narration receives a plain unavailable state while reading continues normally.

Word timing sidecars, text anchors, timed highlighting, route-preserving
playback intent, and offline audio packages remain separate planned slices. The
player does not claim those capabilities merely because basic playback exists.

Publications still control voice labels, provider and model records, clip URLs,
catalog order, and which sections have recordings. Publisher controls validation,
generic preferences, default interaction, failure isolation, and accessibility.
