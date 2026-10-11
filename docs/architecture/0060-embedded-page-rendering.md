# ADR 0060: Embedded page rendering for host transitions

- Status: Accepted
- Date: 2026-08-30

## Context

The official Next renderer supplies a complete Publisher application. Its normal
`renderPage` path owns the publication header, Reader controls, main landmark,
page frame, persistent attribution, and the rendered page body. The generated
host adds document layout, metadata, route continuity, static parameters, error
surfaces, preference prepaint, offline integration, narration providers, and
other Reader lifecycle behavior.

An established publication cannot always replace those surfaces in one step. A
reviewed transition may need to place Publisher-rendered publication content
inside an existing host shell while that host continues to own routing and
Reader lifecycle behavior. Copying the renderer body into the host would fork
safe Markdown, page-kind handling, extension dispatch, theme variables, source
availability, and required attribution. Rendering the complete Publisher page
inside a second shell would instead create duplicate landmarks, navigation,
controls, and layout authority.

The transition needs one narrow server boundary. It must preserve the parts of
the page that remain Publisher invariants without pretending that an embedded
body proves the complete default Reader promised by ADR 0015.

## Decision

`PublicationNextApplication` exposes `renderEmbeddedPage(page)` through the
server-only application API. The method accepts only an immutable page issued by
the same application's `resolveRoute`, just as `renderPage` does. It returns one
React element that the host renders as an opaque value. A host must not inspect,
clone, rewrite, or reach through that element's type or props.

The embedded element retains Publisher ownership of:

- the validated theme scope and page language
- safe server-rendered home, work, collection, section, section-index, Updates,
  and extension route content
- stable page, section, and block markup identities
- server extension slots and the isolated client extension mount, in their
  established order
- the validated publication source link
- the persistent linked GENII Publisher attribution

The embedded element does not render:

- the publication header or Reader rail
- the Publisher skip link
- a `main`, `html`, or `body` element
- the Publisher page frame, reading measure, or page gutter
- Reader preference prepaint
- offline, narration, synchronization, or other Reader lifecycle providers
- the persistent Reader audio host

The host owns the outer shell, the single main landmark, layout, metadata,
continuity handling, static parameters, and error surfaces for an embedded
transition. It also owns any temporary navigation and Reader lifecycle controls.
The host still obtains the page through Publisher route resolution and renders
the returned element directly. The embedded method grants no route, request,
metadata, or provider authority to extensions.

The embedded root uses the selected Publisher theme variables but paints no
canvas of its own. Theme contrast validation compares text, muted text, links,
focus, borders, and surfaces against the theme's declared canvas. The host must
therefore paint that exact validated canvas color behind the transparent
embedded root. A host that needs a different canvas must select a Publisher
theme that validates that color. It must not override the renderer variables
after validation. The embedded content wrapper supplies no width, margin,
padding, or landmark so the host remains the only frame and measure authority.

This is a migration seam, not a second supported application shape. It does not
establish parity for navigation, progress, bookmarks, search, preferences,
offline reading, narration, synchronization, prepaint, or any other Reader
lifecycle feature. A publication may use the seam only with an explicit plan for
the host-owned behavior and must still satisfy the complete migration and
release evidence for the final application.

This decision qualifies ADR 0009 only for `renderEmbeddedPage`: the host owns the
outer framework surfaces during this transition, while Publisher keeps the page
content and attribution invariant. It qualifies ADR 0015 only for this method:
the embedded seam does not satisfy or reduce the complete default Reader
requirement. It qualifies ADR 0050 and ADR 0051 only for this method: server
slots and the client mount keep their order inside the Publisher embedded
content wrapper, which itself sits inside the host-owned main element. Every
other decision in those records remains accepted, and ordinary `renderPage` and
the generated host are unchanged.

## Evidence

Focused application tests must prove that both renderers reject cloned and
foreign pages. Embedded rendering must cover ordinary publication pages,
Updates, and extension pages. It must preserve theme variables, language, safe
content, stable identities, both server slots, the isolated client mount, source
link, and attribution.

Static markup tests must prove that engine-owned embedded markup omits the
header, Reader rail, skip link, main and document elements, and Reader audio
host. Source-boundary and real host integration evidence must separately prove
that `renderEmbeddedPage` does not enter `RootLayout`, prepaint, or provider
composition, because a client provider need not emit a distinctive server HTML
marker. Full `renderPage` output must remain unchanged. Package consumer
evidence must include the server declaration for `renderEmbeddedPage`.

A host integration proof must render the element without inspecting its
internals, paint the exact selected Publisher canvas behind it, retain one main
landmark, and verify readable contrast. That proof does not count as Reader
lifecycle parity.

## Consequences

An established publication can replace content rendering before replacing its
entire shell and browser lifecycle. The transition remains reversible because
the host route and shell can select either its prior content path or the
Publisher element without changing publication data.

Publisher retains one implementation of safe content rendering, extension
ordering, source availability, and mandatory attribution. The host cannot use
the embedded seam to suppress those invariants.

The host must deliberately supply the canvas and every omitted lifecycle
surface. This makes partial adoption honest. It also leaves more acceptance work
than the complete generated host because shell, continuity, errors, providers,
and browser behavior remain host responsibilities during the transition.

## Rejected alternatives

- Copy Publisher page components into the host. That creates a renderer fork and
  loses upgrade authority.
- Render the complete Publisher page inside the existing page. That duplicates
  landmarks, navigation, Reader controls, and layout.
- Add switches to `renderPage` that independently hide attribution, extensions,
  or shell pieces. That creates unsupported combinations and turns invariants
  into caller preferences.
- Return page fragments or component props for host assembly. That lets the host
  inspect and rearrange Publisher internals.
- Paint an arbitrary host background behind transparent Publisher text. Theme
  validation cannot prove contrast against a color it did not validate.
- Treat embedded rendering as Reader parity. The omitted lifecycle systems are
  behavior, not decorative chrome.
