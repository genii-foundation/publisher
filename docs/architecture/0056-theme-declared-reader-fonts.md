# 0056. Theme declared Reader fonts

Status: accepted

Supersedes the theme font portions of ADR 0031, ADR 0036, and ADR 0055.

## Context

The Reader preference document carried a font family identifier, but the
official renderer exposed only a hardcoded serif choice. The stored field could
not express a publication's design, and the theme contract had no authority to
declare safe Reader choices.

A font choice affects first paint, hydrated controls, application identity, and
framework error presentation. Letting those surfaces invent separate policies
would make a returning reader's selection unstable and would make custom theme
proofs cosmetic.

## Decision

Theme API 2.0 requires every theme to declare one ordered list of one through
eight Reader font choices and one default identifier. Each choice contains a
portable stable identifier, a bounded visible label, and a validated CSS font
family value. Identifiers are unique, the list must include `serif`, and the
declared default must name a member of the list.

Validation accepts only a dense plain data array and closed plain data records.
It rejects accessors, symbols, sparse entries, duplicate identifiers, dangerous
identifiers, control characters, declaration characters, and undeclared
defaults. The accepted values are copied into one detached immutable snapshot.
The complete typography snapshot participates in the existing theme token hash,
application identity, and public error identity.

The server writes the declared default to a theme variable. The prepaint script
maps an exact stored identifier to its validated family before body paint. The
hydrated Reader constructs its preference policy from the same snapshot,
renders the theme labels in order, applies the selected family, and persists
only the identifier. An invalid or stale stored identifier falls back to the
declared default through the framework neutral preference parser.

The bundled theme declares Serif and Sans serif choices. The clean packed host
installs a separate theme package with a distinct font identifier and stack. Its
browser proof verifies both the script blocked first paint path and the hydrated
selection, computed manuscript font, and persisted identifier.

## Consequences

Themes written for API 1.0 are incompatible until they add the Reader font
policy and declare API 2.0. This is an adapter migration, not a generated host
migration, so the host contract remains 0.14.0.

The contract selects CSS family stacks. It does not fetch fonts or grant network
authority. A host or theme that needs a web font must load it separately through
its reviewed presentation assets. If that font is unavailable, ordinary CSS
fallback behavior applies.
