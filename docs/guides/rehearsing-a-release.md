# Rehearsing a release

How to exercise the release path locally without publishing anything. Every
command and message here came from running it. A few output lines are long enough
to need wrapping for width, and where that happens the continuation is indented;
nothing else about the output is altered.

This exists because working out how to run `release:prepare` took four failed
attempts, three of them on argument and environment handling rather than on
anything about releases.

## What the release scripts are

`npm run release:prepare` builds one exact tarball per publishable package, hashes
them, and writes a release manifest. It touches no network and needs no
credentials. It does not publish.

`npm run release:verify` takes a manifest that preparation produced and reverifies
those exact paths without rebuilding. Rebuilding would defeat the point: the thing
verified must be the thing uploaded.

Neither script publishes. Publication is a separate workflow step that uploads the
paths preparation produced, and direct package-directory publication is refused
outright by each package's `prepublishOnly` hook.

## Rehearsing the second publication

Run the complete neutral-publication proof through the pinned package manager:

```bash
npm run release:rehearse
```

The rehearsal builds the same six exact package candidates used by release
preparation. It installs those tarballs into a clean, unrelated canonical
publication, writes a lockfile, performs a frozen offline reinstall, and invokes
the installed `genii-publisher` executable. The executable plans and applies the
official host contract, builds the Reader artifacts, and checks that they are
current. The resulting host then performs a production Next.js build and serves
its home, work, and Updates routes with a separately packed theme and extension.

The proof also verifies that canonical publication sources remain byte-identical,
that every installed package has the exact candidate version, and that the same
candidate archive digests remain unchanged after the rehearsal.

This command does not accept provenance records, create a release manifest,
publish packages, or contact a deployment provider. It proves portability. It
does not grant release authority.

## Running preparation

Three things are required, and each one refuses clearly if missing.

An empty output directory, absolute:

```bash
npm run release:prepare
```

```
Release preparation requires --output <absolute-empty-directory>.
```

The exact npm that invoked it, so the tarballs are built by a pinned package
manager rather than whatever is on the path:

```
npm_execpath must identify the absolute npm CLI that invoked this process.
```

Export `npm_execpath` and `npm_node_execpath` when running the script with `node`
directly rather than through `npm run`.

And a release tag matching the version:

```
the --tag argument did not supply a release tag. 0.1.0-alpha.0 is a prerelease and requires --tag next.
```

The tag is not optional for a prerelease. `0.1.0-alpha.0` must be tagged `next`,
because publishing a prerelease as `latest` would hand it to everyone who installs
without a tag. A stable version wants `latest` and may leave the tag unset.

Note that the tag comes from `--tag` here, not from the environment. The same
check runs inside each package's publish hook, where it does come from
`npm_config_tag`, and the message names whichever source applies.

So, all together:

```bash
node provenance/scripts/prepare-release.mjs --output "$PWD/release-out" --tag next
```

## What stops it today

```
Provenance validation failed:
2026-07-28-foundation-extraction.json: release mode requires every package-affecting
  provenance record to be accepted, found draft working-tree record
2026-07-28-publisher-source-loader.json: release mode requires every package-affecting
  provenance record to be accepted, found draft working-tree record
2026-07-28-unicode-portability-preservation.json: release mode requires every
  package-affecting provenance record to be accepted, found draft working-tree record
2026-08-28-supabase-provider-package.json: release mode requires every package-affecting
  provenance record to be accepted, found draft working-tree record
```

This is the gate working, not a failure. Every provenance record touching a package
must be accepted before a release can be prepared, and these are drafts. Accepting
a provenance record is a deliberate human act and preparation refuses to infer it.

Anyone rehearsing the release path should expect this refusal and read it as the
last honest gate rather than as something to work around.

## The other gates

The public web surface now has its own read-only network gate:

```bash
npm run site:build
npm run site:check
npm run release:verify-public-surface
```

The build command creates one provider-neutral artifact under `dist/public-site`
from the exact attributed landing page and reviewed schemas. Its deterministic
manifest records the source, output, size, and digest of every public file. The
local check independently refuses a missing, altered, linked, or unexpected
deployment file before those bytes leave the workstation. The
network gate checks the deployed landing page and every reviewed schema URL
against those exact repository bytes. It follows no redirects and writes no
files. Keep it separate from `release:prepare` and `release:verify`, which remain
offline.

`publisher.genii.foundation` must serve the attribution landing page and stable
schema URLs, because published packages reference those URLs and a manifest
pointing at nothing is worse than an unpublished package.

npm trusted publishing must be bound to the release workflow, so that uploads are
attested to a workflow rather than to a token somebody holds.

The repository workflow is `.github/workflows/publish.yml`. Each npm package must
trust that exact filename in `genii-foundation/publisher` and require environment
`npm-publish`. The GitHub environment should require human approval. Dispatch the
workflow only from an exact `v<package-version>` tag and select the reviewed npm
distribution tag. The workflow refuses branches, token credentials, mixed package
versions, incomplete manifests, and changed archives.

### Verified external status on 2026-08-28

The public GitHub repository exists, is enabled, and uses `main` as its default
branch. The GitHub Actions API exposes only `.github/workflows/ci.yml` on that
branch. The repository environments API reports zero environments, so the
required protected `npm-publish` environment does not exist yet. The checked-in
release workflow remains only a local candidate until it reaches the reviewed
default branch through the ordinary repository process.

DNS returns no A, AAAA, or CNAME record for `publisher.genii.foundation`. The
attribution landing page and stable schema URLs therefore cannot pass the public
surface verifier yet. npm trusted publisher settings are package-account state
and were not inferred from repository files. Recheck every fact immediately before
release. These are release blockers, not permission to create external state.

Preparation and reverification stay on Node 22.12 with npm 10.9. The final upload
step switches to Node 24 with token-free npm 11.5.1, the minimum npm version that
supports trusted publishing. It publishes only the retained tarball paths and
rehashes each one immediately before and after npm reads it.

Publishing six packages is sequential, not transactional. If one upload fails
after an earlier immutable version was accepted, preserve the retained workflow
artifact and investigate. Never rebuild or replace an accepted package version.

The exact prerelease tag must be verified.

A source package passing local tests is not a public release.

## Verifying a prepared release

```bash
node provenance/scripts/verify-release.mjs --manifest "$PWD/release-out/release.json"
```

```
Release verification requires --manifest <absolute-release-manifest-path>.
```

Verification reads the tag out of the manifest rather than from an argument, so a
manifest recording the wrong tag is caught here rather than after upload.

## The guard that runs six times

Each publishable package carries its own copy of `scripts/check-release-tag.mjs`,
because a published package cannot reach into the workspace for a script its own
prepublish hook runs. Six copies that must stay identical is a drift hazard, so
byte equality across them is asserted in `tests/release-tag-copies.test.mjs`. Edit
one and you must edit all six.
