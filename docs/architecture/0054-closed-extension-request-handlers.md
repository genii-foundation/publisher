# ADR 0054: Closed extension request handlers

- Status: Accepted
- Date: 2026-08-19

## Context

ADR 0050 reserved `host.handler` for server request handling. ADR 0052 kept it
separate from declarative page routes because an HTTP handler receives much
greater authority than a server rendered page body. The extension system now
has explicit author registration, exact capability grants, build-bound data,
and a single official Next Proxy boundary. The remaining question is how to
permit useful extension endpoints without letting an extension claim arbitrary
publication paths or framework control.

Capability grants cannot sandbox trusted JavaScript imported by an author host.
They can still limit which extension entry points Publisher invokes and which
data reaches each invocation. The request contract therefore needs narrow path,
method, body, response, and failure rules that remain independently verifiable.

## Decision

Publisher implements `host.handler` as a build-time descriptor projection and a
request-time call through the official host adapter.

An explicitly registered extension may provide an implementation method named
`handlers` when its reviewed manifest grants `host.handler`. Publisher invokes
the method during the ordinary build with only public publication identity, the
extension's own JSON configuration, its own compiled payloads, and its own
optional `serverData`. The input is frozen and contains no Request, environment,
credential, filesystem path, Reader envelope, manuscript block, or data from
another extension.

The projector returns an ordered array of descriptors. Each descriptor has a
stable extension-local ID, one canonical exact path, a nonempty unique method
list from `DELETE`, `GET`, `HEAD`, `OPTIONS`, `PATCH`, `POST`, and `PUT`, plus
optional finite JSON data. Every path must equal or descend from the
engine-owned namespace `/api/extensions/<extension-id>`. Trailing slashes,
patterns, path parameters, duplicate IDs, path collisions, excessive counts,
and invalid JSON fail the build. The descriptors live in the build-bound
extension artifact and participate in its canonical identity.

The official Next registration supplies a `host` adapter with kind
`genii.publisher.next-host-extension`, API version `1.0`, a compatible renderer
range, and `handleRequest`. The adapter is required only when `host.handler` is
granted. It receives one frozen object containing the matched immutable
descriptor, a detached standard Request, and only that extension's optional
`serverData`.

The Next application validates the artifact and registration again. It matches
the URL pathname exactly. An unmatched request falls through to the host. A
matched path with an ungranted method returns `405` with the descriptor's exact
`Allow` value. No extension code runs for either case.

Before adapter invocation, the application reads the request body with a
1,048,576 byte ceiling. A declared or streamed excess returns `413`. The
detached Request preserves the URL, method, and cloned headers, but it does not
carry a live reference to the framework request or its cancellation signal.

The adapter must return a standard Response. Publisher preserves an accepted
response, including streaming bodies. It rejects response headers beginning
with `x-middleware-` or `x-nextjs-` because those names can influence framework
routing. A thrown value, invalid response, or forbidden header returns a generic
`500` without the private failure value.

The generated Proxy remains the only dispatcher. It first applies publication
continuity, then awaits extension handling, then falls through to Next. The
official host contract advances from `0.13.0` to `0.14.0` because `proxy.ts`
becomes asynchronous.

This decision supersedes only the `host.handler` deferrals in ADR 0050, ADR
0051, and ADR 0052. Their other decisions remain accepted.

## Evidence

Publisher tests must prove narrow frozen projector input, exact owned paths,
closed methods, canonical JSON snapshots, collision refusal, bounded output,
diagnostic failure, and inert ungranted projectors.

Next tests must prove exact dispatch, method refusal, detached bodies, the byte
ceiling, compatible adapter requirements, no-match fallthrough, response header
refusal, and generic private failure containment.

The independently packed extension must project a real handler, serve it from a
clean installed host through generated Proxy, reject an unsupported method, and
keep handler data out of static browser chunks.

## Consequences

Extensions can provide callbacks, webhooks, and small dynamic APIs without
editing App Router files or owning arbitrary public paths.

Handler data is server data, but it is not a secret store. Author configuration
remains JSON, and private credentials still come from author-owned runtime
integration outside the build artifact.

The one megabyte request ceiling is part of the official adapter contract. A
larger upload surface requires a separate host integration rather than a wider
implicit grant.

The grant controls Publisher dispatch. It does not isolate imported extension
code from the Node.js process.

## Rejected alternatives

- Let extensions register arbitrary paths. This permits collisions with reader,
  continuity, authentication, and provider routes.
- Pass the live NextRequest. This exposes framework-specific controls and makes
  the adapter contract harder to carry to another renderer.
- Accept route patterns. Pattern precedence would create a second router and an
  ambiguous collision model.
- Buffer request bodies without a ceiling. One extension could consume
  unbounded host memory before its adapter decides whether to accept a request.
- Permit framework control response headers. That would let a handler escape
  its owned endpoint after dispatch.
- Treat capability grants as a security sandbox. Explicitly imported in-process
  JavaScript already has process authority, and pretending otherwise would make
  the boundary dishonest.
