# Publishing a publication

This is the whole author path, start to finish. Every command and every piece of
output here was produced by running it, not by reading the code. A few lines are
long enough to need wrapping for width, and where that happens the continuation is
indented; nothing else about the output is altered.

If you only remember one thing: run `genii-publisher status`. It tells you what
your repository is and what to do next, and it never writes anything.

## What you need

A Git repository. Not a preference. Applying and rolling back both work by
recording the commit you were on beforehand, so a repository with no commits has
nothing to get back to and the engine refuses.

A renderer installed into your repository, such as
`@genii-foundation/publisher-next`. The engine resolves the renderer's host
contract from your own installation rather than depending on a renderer itself,
which is also why a third-party renderer works with no changes here.

Node 22.12.0 or newer, and npm 10.9.0.

## Your publication

A publication is a manifest plus manuscripts. Nothing is generated at this stage
and nothing is installed.

```
estuary/
  publication.json
  publication/
    works/
      rain-gauge/
        work.json
        manuscript.md
    collections/
      weather-observations/
        collection.json
```

`publication.json` declares the publication, its works and collections, its route
templates, and the boundaries of your source tree:

```json
{
  "boundaries": { "sourceRoots": ["publication"], "outputRoots": [".publisher"] }
}
```

Those `sourceRoots` matter more than they look. The engine reads them and refuses
to write anything inside them, so your manuscripts and assets are not reachable
by any command. You do not need to pass a flag for this. If your publication
lives somewhere other than `publication/`, say so there and the protection
follows.

If your repository holds something the manifest has no reason to mention, such as
editorial notes or provider state, protect it too:

```bash
genii-publisher status --protected-root editorial
```

`--protected-root` is repeatable and adds to what the manifest declares. It never
replaces it, so forgetting the flag cannot leave your sources exposed.

A manifest that exists but cannot be parsed is refused rather than treated as
declaring nothing. Returning no protection from an unreadable manifest would turn
a typo into an unprotected tree.

An Updates route is not servable by the Next renderer. If your manifest declares
`routes.updates`, `build` refuses before writing anything and names the route,
because writing the artifact would leave a host that fails to start. Updates
support is a known gap rather than a bug in your manifest.

If you want a working publication to start from, copy `fixtures/canonical-tide-tables`.
It is the one fixture the shipped renderer can serve end to end. The other two
declare Updates routes and exist to exercise the protocol rather than to be
copied.

Three things that catch people, all refused with the file and the field named:

`attribution` must carry the exact required notice. Only `sourceCodeUrl` is
yours to set. See the attribution section below.

A collection lists its works as `workIds: ["rain-gauge"]`, while
`publication.json` lists works as `works: [{ "id": "rain-gauge" }]`. Two shapes,
two key names, for what looks like the same thing. Sorry.

## What a manuscript becomes

One page. This surprises people, so it is worth stating before you write anything
long.

A work's manuscript compiles to a single addressable unit at the work's route. Your
headings do not become separate pages and do not become separate entries in
navigation. They stay inside the one page as content.

```
publication/works/first-light/manuscript.md   ->   /works/first-light
  ## Low water                                     (a heading inside that page)
```

Each block, headings included, does get an identifier in the artifact, so a
renderer can link to a heading within its page. That identifier is derived from the
block's own content, which has one consequence worth knowing before you rely on it:

```
heading anchor, original     b-c3752db1c2d4d60975c206cc
after retitling the heading  b-cb4d3f9e7bcb98d70cc2b7b3   changed
after editing a paragraph     b-c3752db1c2d4d60975c206cc   same
```

Rename a heading and any link to it breaks. Editing text elsewhere in the page
leaves it alone, so the identifier is at least stable against unrelated edits.

Sections addressable at their own paths are expressible in the protocol, and a
publication assembled directly against the compiler can have them. What does not
exist yet is a way for an author to declare where a manuscript's sections begin, so
the build path produces one. If you need per section URLs today, the honest answer
is that this engine cannot give them to you from a manuscript, and the decision
about how you would declare them is open.

## Where you are

Start here, always. On a repository that is not yet a host:

```bash
genii-publisher status
```

```
Host         /home/you/estuary

Not an initialized host. No publisher.host.json here.

Next
  initialize this host
```

It exits nonzero whenever something needs doing, so a build script can use it
directly.

## Initializing

Every command that writes comes in two halves. `plan` computes exactly what would
change and writes nothing. `apply` takes the plan's hash and refuses if anything
moved since you looked.

```bash
genii-publisher init plan
```

```
Host        /home/you/estuary
Renderer    @genii-foundation/publisher-next 0.1.0-alpha.0
Contract    0.1.0
Layout      canonical
Plan        sha256:5e61669d9e3f7e3323f0d1f726677d80a3a9422a56e79cf8ce3a08e030520dac

  write    app/[...segments]/page.tsx
  write    app/error.tsx
  write    app/global-error.tsx
  write    app/layout.tsx
  write    app/not-found.tsx
  write    app/page.tsx
  write    next-env.d.ts
  write    next.config.mjs
  write    package.json
  write    pages/404.tsx
  write    pages/500.tsx
  write    pages/_app.tsx
  write    pages/_document.tsx
  write    pages/_error.tsx
  write    proxy.ts
  write    publisher-application.js
  write    publisher-error-identity.ts
  write    publisher.host.json
  write    tsconfig.json

19 file(s) would be written. Nothing has been yet.
Apply with:
  genii-publisher init apply --host /home/you/estuary --plan sha256:5e61669d9e...
```

Read the list. Then apply it:

```bash
genii-publisher init apply --plan sha256:5e61669d9e...
```

```
Initialized /home/you/estuary
19 file(s) written.
Baseline commit 36cc1b554b5fee3b5e9edc9d4915736fa14e6dbf
Review the change and commit it, including publisher.host.json.
```

Passing the plan hash is not ceremony. It is the difference between applying the
change you reviewed and applying whatever the situation has become.

`publisher.host.json` is yours and belongs in version control. It records which
renderer this host uses, which contract version it is on, and the digest of every
file the engine manages. Commit it. Every later command reads it, which is why
you never need `--renderer` again.

No `--renderer` above. On a repository that is not yet a host the default is
`@genii-foundation/publisher-next`; once initialized, every command reads the
renderer your host recorded.

Adopting an existing repository whose layout is not the canonical one works the
same way with `--layout declared`. Declare your real paths in `publication.json`
and nothing moves.

## Building

```bash
genii-publisher build
```

```
Publication  /home/you/estuary
Artifact     publication-reader.json
Digest       sha256:02989c86def31920e6d4ea753e0bd138d54398ae4c30486a706ee053fc53a594
Size         5,311 bytes
Written.
```

No `--renderer`. The host records it, and asking for a different one is refused,
because each renderer declares its own location for the artifact and building
through the wrong one would put the artifact where your generated code does not
import it and then report success.

Build during ordinary work with a dirty tree. Unlike the lifecycle commands, this
one does not need Git to be clean, because the artifact is derived output rather
than something of yours it could lose.

If your publication and your host are separate directories, point at it:

```bash
genii-publisher build --publication ../content/estuary
```

The default is the host root, which is the usual arrangement. Note that a
publication outside the host cannot have its source roots protected by anything,
because nothing the engine writes can reach outside the host root in the first
place.

The reader artifact is projected for one audience. `--audience public` is the
default and leaves out every work whose `publicationState` is `draft`.
`--audience preview` keeps them, for a preview deployment. The two produce
different artifacts, so a preview build must not be deployed as the public one.

Building twice over unchanged sources writes nothing and says so. The file's
modification time stays put, so a watching build tool is not restarted by an
identical write.

### Deciding what happens to the artifact

Pick one, now, before it bites you:

**Commit it.** Then your repository holds exactly what it serves, and continuous
integration can prove the committed artifact is current:

```bash
genii-publisher build --check
```

```
Expected     sha256:126ee65b6002021f37351a8c5b0f4fab8e9fdc46fbc7f95c398a9dabc6156b4a
On disk      sha256:02989c86def31920e6d4ea753e0bd138d54398ae4c30486a706ee053fc53a594

The artifact on disk was built from different sources. Run build.
```

It exits nonzero when the artifact is stale or missing, and it writes nothing, so
it is safe to run anywhere.

**Or ignore it,** and build in continuous integration before deploying.

What does not work is neither. An artifact that is untracked and not ignored makes
your tree permanently dirty, and `upgrade` and `rollback` both require a clean
tree, so they will refuse forever with a complaint about a file the engine itself
wrote. That is the state a fresh host lands in by default, so `status` calls it
out:

```
Artifact     publication-reader.json is current  (neither committed nor ignored)

Next
  decide whether publication-reader.json is committed or ignored, because
  upgrade and rollback need a clean tree
```

## Upgrading

Install a newer renderer. `status` notices:

```
Contract     recorded 0.1.0, installed 0.2.0  (upgrade available)

Next
  upgrade to the installed host contract
```

```bash
genii-publisher upgrade plan
```

```
Contract    0.1.0 to 0.2.0
Plan        sha256:56eafc31a1487e398bbef7e357da5ab0e55829fee38c922c9be96efa816d2ac4

  write    app/error.tsx
  current  app/page.tsx
  current  package.json
  write    publisher.host.json

Route
  0.1.0 to 0.2.0  adds an error boundary

Manual steps this tooling will not perform:
  Clear your build cache before the next deploy.

2 file(s) would be written. Nothing has been yet.
```

`current` means the file already holds what the new contract wants. Files the old
contract owned and the new one does not are removed and shown as `remove`.

The route is the sequence of contract versions being crossed. There is exactly
one, or the upgrade is refused. No guessing between versions.

Some upgrades need something the engine cannot do, such as a provider setting or
a cache clear. It will not pretend otherwise:

```bash
genii-publisher upgrade apply --plan sha256:56eafc31a1...
```

```
HostUpgradeError: This upgrade requires 1 step(s) the engine will not perform:
  Clear your build cache before the next deploy.
Confirm they have been read before applying.
```

Add `--acknowledge-manual-steps` once you have read them. That flag is the only
thing the engine can honestly ask for: it cannot verify your cache.

### If a file no longer matches

A file you edited by hand shows as `CONFLICT`, the plan is refused, and nothing is
written:

```
  CONFLICT  app/page.tsx

1 file(s) differ from what the engine last wrote.
Review them and either restore them or record the change deliberately.
Nothing has been written.
```

The engine will not overwrite work it did not do.

## Undoing

Every apply records the commit it ran against and the digest of everything it
wrote.

```bash
genii-publisher rollback plan
```

```
Undoing     initialize sha256:c95b3b451a...
Baseline    9761927eb4904ea695c68c541274e6a74e11ac17

  remove   app/page.tsx
  remove   package.json
  remove   publisher.host.json
```

```bash
genii-publisher rollback apply --plan sha256:f4d70435...
```

Rollback restores exactly the paths it recorded, to exactly the content the
baseline commit held. It is deliberately not `git checkout` plus `git clean`: a
clean would delete untracked files, so undoing an engine change would also delete
your unrelated scratch work. Anything the engine did not write is left alone.

A file you have changed since the apply is a conflict, not something rollback
quietly reverts. Fix the file and the rollback becomes available again.

## If a command is interrupted

Writes are transactional. An interrupted apply leaves a journal, and the next
command restores the baseline from it. To do that by hand:

```bash
genii-publisher recover
```

## What the engine will never write

Regardless of what any renderer declares or any flag says:

Anything under `.git`, `.publisher`, or `node_modules`. Any `.env` file. Anything
inside a source root your manifest declares. Anything outside your host root.
Anything reached by following a symbolic link. `publisher.config.ts`, which is
reserved and never read or evaluated.

A renderer that aims its artifact at one of its own contract files is refused too,
because every build would silently overwrite that file.

## Attribution

The footer notice is fixed and the schema enforces it exactly:

```json
{
  "attribution": {
    "placement": "footer",
    "copyright": "Copyright 2026 GENII Foundation",
    "text": "Published with GENII Publisher",
    "url": "https://publisher.genii.foundation",
    "sourceCodeUrl": "https://github.com/you/your-publication"
  }
}
```

This engine is licensed under CPAL 1.0, which requires that attribution be
displayed. An editable attribution notice would not be an attribution notice, so
four of those five fields are constants and only `sourceCodeUrl` is yours.

Be aware of what this currently means: the footer shows the Foundation's
copyright, and there is no field for your own. If you need your copyright on the
page, put it in your prose for now. This is a known gap rather than a decision
anyone is happy with.

Editing any of the four fixed fields is refused, and the refusal says why rather
than only that a constant did not match:

```
must be equal to constant. This engine is licensed under CPAL 1.0, which requires
that the Original Developer's attribution be displayed, so the notice is fixed and
cannot be rewritten. It is not a claim over your work. Your own copyright has no
field in this manifest yet, and sourceCodeUrl is the one attribution field you set.
```

## What your renderer can serve

A renderer declares which route kinds its generated host can serve, and `build`
refuses an artifact containing anything else. That refusal happens before a byte
is written, because the alternative is a successful build and a host that will not
boot, which is a much worse place to find out.

```
/home/you/estuary cannot serve this publication.
  host.route_kind_unsupported   /routes/active
    This publication has 1 updates route(s) that @genii-foundation/publisher-next
    cannot serve: /updates. Writing the artifact would leave a host that fails to
    start, so nothing has been written. Remove the route from your publication
    manifest, or use a renderer that serves it.
```

`status` reports the same thing under "This host cannot serve".

A renderer that declares no capability set at all is refused rather than assumed
capable. An absent declaration and a claim of full support are different claims,
and only one of them is safe to guess at.

## Command summary

| Command | Writes | Needs a clean tree | Exit nonzero when |
| --- | --- | --- | --- |
| `status` | no | no | anything needs doing |
| `init plan` | no | no | a file conflicts |
| `init apply` | yes | yes | the plan moved, or a file conflicts |
| `build` | the artifact only | no | the publication does not compile |
| `build --check` | no | no | the artifact is stale or missing |
| `upgrade plan` | no | no | a file conflicts |
| `upgrade apply` | yes | yes | manual steps are unacknowledged |
| `rollback plan` | no | no | a file changed since the apply |
| `rollback apply` | yes | no | a file changed since the apply |
| `recover` | restores a baseline | no | never |

Add `--json` to any of them for machine readable output. Stdout is always a JSON
document, on success and on failure, and the exit code says which. There are two
shapes: a command reporting its own result emits that result, and a command that
refuses outright emits `{"valid": false, "error": {...}}`. The human readable
message goes to stderr either way, so piping stdout into a parser does not hide
what happened from you.

You never need `--renderer` after initializing. Every command reads the renderer
your host recorded, and naming a different one is refused rather than obeyed.

## Narration and synchronization

Both are optional, both are declared in `publication.json`, and both produce a file a
client fetches rather than anything the server renders.

Narration needs a clip catalog. Declaring `audio` without one is refused, because the
adapter is recorded for provenance and never executed, so a catalog is the only way
clips reach a build:

```json
"audio": {
  "adapter": { "package": "your-narration-pipeline" },
  "catalog": "publication/audio/catalog.json"
}
```

The build cross-checks every clip against the sections the publication actually has,
reports coverage per voice, and writes the narration envelope beside the reader
artifact. `build --check` then fails if either goes stale, so prose and narration
cannot drift apart unnoticed.

The engine does not decide when narration is out of date. A clip's version token is
your pipeline's, composed however that pipeline composes it, and the engine treats it
as opaque. Regenerate the catalog when prose changes and the engine will publish what
you regenerated.

Synchronization declares a provider and what a reader may choose to synchronize:

```json
"sync": {
  "provider": { "package": "your-sync-provider" },
  "consent": "opt-in",
  "localFallback": true,
  "capabilities": ["progress", "bookmarks"]
}
```

The capability list is closed: `progress`, `bookmarks`, `engagement`,
`account-deletion`. Consent is not among them, because it is pinned to `opt-in` for
every synchronizing publication rather than being something a reader turns on.

Provider configuration stays out of the published file. The artifact a client fetches
carries the provider's package name and nothing else, so a project reference or a key
in your config never leaves the repository.

Two routes are still yours to wire, an authentication callback and account deletion.
Both determine public URLs and both wait on a decision recorded in ADR 0014.
