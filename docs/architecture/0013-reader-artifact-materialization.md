# 0013. Reader artifact materialization

Status: accepted

## Context

Four pieces existed and nothing joined them. The loader reads a publication tree
into a trusted snapshot. The compiler turns that into a content envelope. The
projector turns the envelope into a reader envelope. The renderer's host contract
declares where the reader artifact belongs in a host.

The only code that had ever run all four was a test helper. That helper derived
the compiler's work inputs by asserting, which is right for a test and useless
for an author: an assertion says the process stopped, not which work in which
manifest is missing which manuscript.

The artifact destination is declared by the renderer, and a renderer is a
third-party package.

## Decision

The pipeline is one function in the application package. It writes nothing and
returns the artifact text, because where the text belongs is the renderer's
decision and the caller's to carry out.

Every failure is a diagnostic naming the document an author would open, not an
exception.

A work's root section identity is engine-owned and derived from the work. It
participates in route ownership and link resolution and never appears in a URL,
so it is safe for the engine to decide. A work with more than one section will
add siblings to the root section rather than renaming it.

A work's declared route is a work-level address. The publication's route
templates already grant the work that path, so the root section is given no
route. Granting it the same path makes two owners of one route.

Extensions are stamped with the engine version that resolved them, never a
version read from the manifest. A manifest declares which extension it wants,
not which build ran.

Materialization does not use the lifecycle transaction. The transaction protects
author files: it requires a clean Git tree so a rollback can get back, and it
treats a file matching neither its expected preimage nor its intended result as
a conflict to review. Both are correct for a host contract and wrong for
generated output. Requiring a clean tree before every build would make building
during ordinary work impossible, and refusing to overwrite a stale artifact
would refuse the point of the command.

Materialization does use the same mutation policy and the same path resolver as
the transaction. The destination is declared by a third-party package, so it
gets the same hard denials, the same symlink and escape refusals, and the same
protected roots.

A declared destination that collides with a renderer-managed contract file, or
with the engine's host state file, is refused. The policy cannot catch this: a
path in an allowlist is allowed by construction. The comparison is case-folded,
because on a case-insensitive filesystem a different spelling is the same file.

Writes are atomic through a staged file renamed within the destination
directory, and fsynced before the rename. An identical artifact is not
rewritten, so a watching build tool is not restarted by a byte-identical write.

A check mode compares the artifact on disk against what a build produces and
writes nothing. A repository that commits generated output has no other way to
prove the committed artifact is current.

Each package compiles against its dependencies' emitted declarations, so build
order is a checked property of the real dependency graph rather than a
convention.

## Consequences

A build runs during ordinary work with a dirty tree, which is what authors
actually do.

A generated artifact can be committed and verified in continuous integration,
and the artifact carries nothing about where it was built, so an author's machine
and a build server produce the same bytes.

A renderer cannot use its artifact declaration to reach anything the lifecycle
commands could not reach.

Rolling back a build is not offered, because there is nothing to roll back to:
the artifact is derived, and rebuilding reproduces it.

## Alternatives considered

Materializing through the lifecycle transaction. Rejected: it would require a
clean Git tree for every build and would treat a stale artifact as a conflict.

Weakening the transaction with a mutation that overwrites regardless of
preimage. Rejected: that hole would then be available to init and upgrade, where
the preimage check is what protects author work.

Writing the artifact to the location the reader envelope declares for itself.
Rejected: that path is where the artifact lives inside a content bundle, a
different namespace from where a renderer's generated host code imports it.
