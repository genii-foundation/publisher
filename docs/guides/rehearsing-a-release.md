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
  provenance record to be accepted, found draft historical record
2026-07-28-publisher-source-loader.json: release mode requires every package-affecting
  provenance record to be accepted, found draft working-tree record
2026-07-28-unicode-portability-preservation.json: release mode requires every
  package-affecting provenance record to be accepted, found draft working-tree record
```

This is the gate working, not a failure. Every provenance record touching a package
must be accepted before a release can be prepared, and these are drafts. Accepting
a provenance record is a deliberate human act and preparation refuses to infer it.

Anyone rehearsing the release path should expect this refusal and read it as the
last honest gate rather than as something to work around.

## The other gates

Recorded in the README and not enforced by these scripts, because they are about
the world rather than the repository:

`publisher.genii.foundation` must serve the attribution landing page and stable
schema URLs, because published packages reference those URLs and a manifest
pointing at nothing is worse than an unpublished package.

npm trusted publishing must be bound to the release workflow, so that uploads are
attested to a workflow rather than to a token somebody holds.

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

## The guard that runs five times

Each publishable package carries its own copy of `scripts/check-release-tag.mjs`,
because a published package cannot reach into the workspace for a script its own
prepublish hook runs. Five copies that must stay identical is a drift hazard, so
byte equality across them is asserted in `tests/release-tag-copies.test.mjs`. Edit
one and you must edit all five.
