# Publishing a publication

This is the whole author path, start to finish. Every command and every piece of
output here was produced by running it, not by reading the code.

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
genii-publisher init plan --renderer @example/renderer
```

```
Host        /home/you/estuary
Renderer    @example/renderer 1.4.0
Contract    0.1.0
Layout      canonical
Plan        sha256:c95b3b451a1e8750bed4d773d11a40fb9db2f244ec208e9dfb6614acf9483048

  write    app/page.tsx
  write    package.json
  write    publisher.host.json

3 file(s) would be written. Nothing has been yet.
Apply with:
  genii-publisher init apply --host /home/you/estuary --plan sha256:c95b3b451a...
```

Read the list. Then apply it:

```bash
genii-publisher init apply --renderer @example/renderer --plan sha256:c95b3b451a...
```

```
Initialized /home/you/estuary
3 file(s) written.
Baseline commit 9761927eb4904ea695c68c541274e6a74e11ac17
Review the change and commit it, including publisher.host.json.
```

Passing the plan hash is not ceremony. It is the difference between applying the
change you reviewed and applying whatever the situation has become.

`publisher.host.json` is yours and belongs in version control. It records which
renderer this host uses, which contract version it is on, and the digest of every
file the engine manages. Commit it. Every later command reads it, which is why
you never need `--renderer` again.

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
Digest       sha256:6a7dcd825ae631ce7f86d69360e374ee7b75f39854f24076628405044113d0f0
Size         5,523 bytes
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
Expected     sha256:ad7b9dad4255bc77912466e9be736d6386e2afa407ef584439bc56168322d17a
On disk      sha256:6a7dcd825ae631ce7f86d69360e374ee7b75f39854f24076628405044113d0f0

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

Add `--json` to any of them for machine readable output.
