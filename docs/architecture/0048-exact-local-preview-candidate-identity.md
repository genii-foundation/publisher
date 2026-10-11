# ADR 0048: Exact local preview candidate identity

Status: accepted

## Context

A local preview is useful migration evidence only when an operator can tell
which worktree, branch, commit, and source bytes it represents. A branch name and
commit alone are insufficient because a preview often contains reviewed local
changes. A digest of Git status and diff text is also insufficient. Its meaning
depends on Git presentation, it does not expose an inspectable file inventory,
and a naive untracked-file read can follow a symbolic link outside the worktree.

The engine cannot prove that an arbitrary server process used a repository. The
host preview manager owns process startup, readiness, URL, and process state.
The engine can own the reusable identity that the manager captures after startup
and verifies while handing off that preview.

## Decision

Publisher defines a versioned local preview candidate identity. It contains the
canonical absolute Git worktree root, branch or detached state, full HEAD commit,
dirty state, and an inspectable inventory of every present tracked or untracked,
nonignored path. Every regular file entry records exact byte length and SHA-256.
Every symbolic link records the raw link-target byte length and SHA-256 without
following the link. The candidate digest binds the ordered inventory. A separate
identity digest binds that candidate to the worktree, branch, commit, and dirty
state.

Ignored dependencies, credentials, generated output, and private local state are
outside this claim. A preview manager must capture after any startup step that
generates source. Saved evidence should live in an ignored location so the
evidence file does not change the candidate it describes.

Capture is read only and offline. Git output has fixed bounds and fatal UTF-8
decoding. Unmerged indexes and submodules are refused because their candidate
bytes cannot be inferred from one worktree inventory. Regular files are opened
without following the final path, read and hashed twice from one descriptor, and
checked against filesystem identity before and after. Symbolic-link parents,
special files, path escapes, duplicate paths, file changes, directory changes,
and Git changes during capture are refused.

The public Node API captures, parses, and verifies evidence. Parsing recomputes
both digests and rejects unknown fields, malformed counts, unsorted entries, and
unsupported versions. Verification recaptures the candidate and reports whether
worktree, branch, commit, dirty state, candidate bytes, or full identity changed.
The command line exposes the same contract as `preview identity` and `preview
verify`. Neither command starts a server or writes a file.

## Consequences

A managed local preview can display specific, independently verifiable evidence
instead of the reassuring but empty phrase "current branch." Detached worktrees
remain distinguishable. Dirty previews are allowed because reviewed local
changes are a normal migration candidate, but their exact bytes are visible.

The identity is intentionally local and not reproducible across paths. Build and
release provenance remain separate portable contracts. The preview manager must
store its URL and process identity beside this evidence if those facts matter to
handoff.

Very large repositories and paths outside the bounded Git candidate set are
refused. Git submodules require separate capture rather than an invented parent
digest. Ignored files may affect a framework at runtime, so a host that treats an
ignored file as publication source must move it into an explicit tracked or
untracked candidate path before claiming exact preview evidence.

## Rejected alternatives

### Hash Git status and diff text

That hashes one presentation of changes rather than an inspectable candidate
tree and can follow untracked symbolic links accidentally.

### Require a clean tree

That excludes the main local-preview use case, which is reviewing exact changes
before commit. Dirty state is evidence, not a reason to erase the evidence.

### Include ignored dependencies and credentials

That expands a source identity into an unbounded machine snapshot and risks
recording secrets. Dependency installation and release provenance have separate
authorities.

### Let the engine start every host preview

Framework startup, readiness, ports, and process recovery belong to the host.
The reusable engine contract is the candidate identity that host tooling binds
to its managed process.
