# ADR 0062: Public narration word ranges

- Status: Accepted
- Date: 2026-08-30

## Context

ADR 0040 defines one closed spoken-text profile for narration timing. Its
character ranges use UTF-16 offsets into the canonical title and normalized body
text. The Reader package counts words with one Unicode scanner, while the Next
renderer previously repeated that scanner to create existing manuscript word
anchors.

The two patterns currently agree, but agreement by duplication is not a public
contract. An established host that retains its Reader lifecycle also needs a
browser-safe way to relate the canonical profile to Publisher's server-rendered
body anchors without importing a private Next implementation or activating a
provider, store, DOM helper, or timing fetch.

## Decision

The Reader narration entry exports `ReaderNarrationWordRange` with numeric
`charStart` and `charEnd` fields. It also exports
`createReaderNarrationWordRanges(text)`, which applies the exact scanner
`[\p{L}\p{N}][\p{L}\p{N}'’·ˈ]*` in Unicode global mode. Each start is inclusive,
each end is exclusive, and both are UTF-16 code-unit offsets into the exact input
string. The returned array and every returned range are frozen.

`countReaderNarrationWords(text)` uses the same scanner and returns its count
without allocating the public range projection. Its behavior for valid and
invalid runtime inputs remains unchanged. The spoken section profile shape,
timing document schema, range semantics, alignment policy, and identity inputs
do not change.

The Next focus-markup transform consumes the public Reader function and carries
no duplicate narration scanner. Its existing `publisher-narration-word` class
and `data-publisher-narration-word="true"` attribute do not change. Focus
segmentation, exclusions, and the single accessible text occurrence also remain
unchanged.

An external host may bind the ordered anchors only inside one exact rendered
section. It creates the canonical section profile, creates ranges over
`profile.text`, and first proves that the timing document has the same total
range count and that every timing word's `charStart` and `charEnd` equal the
corresponding canonical range. It then drops the first
`profile.titleWordCount` ranges because the title is outside the body anchor
sequence. Before binding timing, the host must prove that the remaining range
count equals the anchor count and that each anchor's `textContent` exactly equals
`profile.text.slice(range.charStart, range.charEnd)`. A count match alone cannot
authorize binding. Any mismatch fails closed and leaves narration playback
available without word highlighting.

The function is browser safe and pure. It reads no DOM, network, filesystem,
storage, clock, environment, provider, or store.

This decision extends ADR 0040 and ADR 0036. It does not replace their text
ownership, timing validation, or accessibility boundaries.

## Evidence

Reader tests cover the exact scanner, astral Unicode, UTF-16 code-unit
boundaries, frozen records, frozen arrays, text slicing, count identity, and the
preserved invalid runtime behavior. Next tests prove that ordered anchor text
equals the public ranges while preserving the exact class, data attribute, and
complete rendered text.

The packed Reader consumer must import the function and type from the public
`narration` entry, typecheck them, and exercise the frozen browser runtime result.
Package builds and declaration comparisons must prove that Next consumes the
public entry and carries no private Reader dependency.

## Consequences

Timing producers, Publisher renderers, and transition hosts now share one word
boundary authority. Unicode scanner changes become explicit Reader API changes
instead of silent renderer drift.

Hosts still own their exact section lookup and DOM verification. The public
ranges do not grant authority to search the complete document, trust a count
alone, fetch timing data, mutate anchors, or activate Reader lifecycle behavior.

## Rejected alternatives

- Export the regular expression. Mutable `lastIndex` state and caller-controlled
  execution would make the result less safe than a frozen projection.
- Add word text to every range. The canonical text already owns those bytes, and
  slices are the required binding proof.
- Carry ranges in the Reader artifact. They are deterministic from the existing
  spoken profile and would duplicate derived data in a build-bound artifact.
- Keep the Next pattern synchronized by tests. That still leaves hosts dependent
  on a private implementation and permits future drift between public counting
  and rendered anchors.
