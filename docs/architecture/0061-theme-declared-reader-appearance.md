# ADR 0061: Theme declared Reader appearance palettes

- Status: Accepted
- Date: 2026-08-30

## Context

Theme API 2.0 validates one base color palette. Reader preferences can select
light, dark, or black appearances, but the renderer stylesheet supplies those
three palettes as fixed Publisher colors. A custom theme therefore controls its
initial appearance and then loses color authority when a reader selects another
scheme.

ADR 0055 deliberately deferred theme specific scheme palettes to a separate
contract. ADR 0060 also requires an embedded host to paint the exact validated
Publisher canvas behind a transparent embedded root. Without a read only theme
projection, an established host must duplicate renderer colors to satisfy that
requirement. The duplicate can drift from validation while looking correct in
one mode.

The missing boundary is theme data, not another Reader lifecycle surface.
Palette selection must not activate browser storage, providers, stores, or
hydrated controls merely to tell an embedded host which canvas was validated.

## Decision

Theme API 2.0 retains `tokens.color` as its required base palette and accepts one
optional `tokens.colorSchemes` record. When present, that record must contain
exactly complete `light`, `dark`, and `black` palettes. Each palette uses the
same seven color fields as the base palette and passes the same opaque color and
contrast validation independently.

The optional record is all or nothing. Themes cannot inherit individual fields
between schemes. A legacy Theme 2.0 instance with no record remains valid and
uses its base palette for all three named schemes. This fallback belongs to the
theme instance. It never imports colors from the bundled Publisher theme.

The bundled default theme declares all three palettes explicitly. Its base
continues to follow the configured light or dark mode. A configured accent also
applies to the matching named palette, so choosing that explicit Reader scheme
does not discard the configured accent. The black palette retains the existing
default black appearance.

The browser safe theme entry exports
`projectPublisherNextThemeAppearance(theme)`. It accepts one validated theme
instance and returns one frozen read only projection with `base`, `light`,
`dark`, and `black` palettes. It performs no I/O, reads no DOM or browser state,
and activates no Reader provider or store. The established `system` Reader
preference selects the base palette.

The renderer writes the projected named palettes into theme scoped custom
properties beside the existing base properties. Static scheme selectors only
select those properties. The stylesheet contains no alternate palette values.
The head prepaint remains responsible only for validating the saved preference
document and setting its scheme attribute before body paint. Hydrated Reader
state remains responsible for later preference changes.

An embedded host may configure and validate the selected theme, serialize the
pure appearance projection into its own reviewed prepaint, and paint the
projected effective canvas behind the transparent Publisher root. This grants
no authority to inspect the returned Publisher element or activate Publisher
Reader lifecycle components.

The supplied scheme record participates in the existing theme token hash and
therefore in application identity. No application manifest field or schema
version changes. Existing immutable package candidates remain historical
artifacts. A host that uses the new optional field or projection must pin a
Publisher candidate that contains this contract.

This decision supersedes the deferred palette statement in ADR 0055. It extends
ADR 0056 without changing its font policy and qualifies ADR 0060 by defining the
read only source for the exact embedded canvas.

## Evidence

Focused validation must prove that legacy one palette themes remain accepted,
all legacy projected schemes equal the base palette, and a supplied scheme
record is complete, detached, immutable, and accessor safe. Every palette must
exercise malformed color and contrast rejection at its exact diagnostic path.

Renderer tests must prove that full pages, embedded pages, error surfaces, and
the persistent audio host receive scheme variables derived from the validated
projection. Stylesheet inspection must reject fixed alternate palette colors.
Package consumer evidence must expose the same projection function through the
root and theme entries.

A real packed host proof must eventually select a separately packaged theme,
persist a nonbase scheme, block hydration scripts, and verify the actual
computed palette before paint. An embedded host proof must independently verify
that its backing canvas equals the projected effective canvas. Neither proof
may substitute for the other.

## Consequences

Custom themes can own every supported Reader color appearance without arbitrary
CSS or component replacement. Legacy themes stay usable and no longer switch to
unrelated Publisher colors.

Embedded hosts can satisfy the exact canvas obligation from validated public
theme data. They do not need Publisher preference storage, providers, or stores
to calculate that color.

Adding a scheme record changes theme identity and requires ordinary candidate
review. It does not change routes, content, Reader private state, or publication
data.

## Rejected alternatives

- Keep alternate palettes in the renderer stylesheet. This makes custom themes
  cosmetic after the first preference change.
- Let hosts override Publisher variables. Contrast validation cannot prove the
  resulting colors.
- Accept partial scheme records. Hidden inheritance makes review and identity
  ambiguous.
- Read local storage inside the projection helper. That converts pure theme data
  into browser lifecycle authority.
- Require every existing Theme 2.0 package to add three palettes. That is not
  necessary for safe rendering and would invalidate established adapters.
