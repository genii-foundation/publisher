# Licensing GENII Publisher

GENII Publisher uses the Common Public Attribution License Version 1.0, identified by SPDX as `CPAL-1.0`. The authoritative terms are in the repository [LICENSE](../LICENSE). This guide explains the intended compliance workflow. It does not replace the license and is not legal advice. Qualified legal counsel should review the populated exhibits and the release packaging before version 1.0.

## Scope

GENII Publisher is the Original Code. GENII Foundation is both the Initial Developer and the Original Developer.

CPAL applies to Covered Code identified by the Exhibit A notice and to related Modifications of that engine code. Publication manuscripts, artwork, recorded narration, editorial profiles, and other independently licensed author content are separate from Covered Code. Rendering or publishing that content with GENII Publisher does not express an intent by GENII Foundation to place it under CPAL. Authors should give their content its own explicit license or copyright notice. Code copied from or modifying GENII Publisher remains subject to CPAL.

No alternative license is designated for the Original Code.

## Attribution

The populated Exhibit B requires the following Attribution Information:

* `Copyright 2026 GENII Foundation`
* `Published with GENII Publisher`
* `https://publisher.genii.foundation`
* No graphic image

The phrase contains four words, which is within CPAL's limit of ten words. The requirement applies to Larger Works.

GENII Publisher's graphical reader presents the Attribution Information in a persistent footer. Preserve that footer on every graphical publication surface where an end user accesses Covered Code. The phrase must link to the Attribution URL, and the copyright notice must remain available as part of the footer attribution. If another party receives comparable attribution, the GENII Foundation attribution must be no less prominent.

CPAL Section 14 requires a prominent display when a graphical application is launched or initially run. It names a dedicated attribution area as one way to comply. The license exhibit does not contain a separate field that can impose an exact footer location or continuous display duration. The persistent footer is therefore also an engine interface and compatibility requirement. A qualified lawyer should review whether a materially different display satisfies Section 14.

## Network use and source availability

CPAL Section 15 treats External Deployment as distribution when Original Code or Modifications can be used by anyone other than the deployer, including use through a network application. A network deployer must make the corresponding Covered Code Source Code available under CPAL whether the engine is unchanged or modified. If it is modified, the source must include the deployed Modifications.

The source offer must reach anyone to whom the Executable version was made available. If source is supplied through an electronic distribution mechanism, Section 3.2 requires it to remain available for at least twelve months after its initial availability, or for at least six months after a subsequent version of that Modification is made available to those recipients. The deployer remains responsible if a third party hosts the source.

The available Source Code must be the preferred form for modification. Include the modules, interface definitions, build scripts, installation scripts, and other material covered by the definition in Section 1.11. Publish the exact deployed revision or enough information to identify it without guesswork.

An executable distribution or network deployment must conspicuously state that the Source Code for its Covered Code is available under CPAL and provide a working source location. That source must include the covered engine code and the exact deployed Modifications. The notice and source location concern Covered Code, not the author's manuscript or other independently licensed publication content.

## Modification records

CPAL Section 3.3 requires Covered Code to contain a file that documents each Contributor's changes and the date of each change. It also requires a prominent statement that the Modification derives from GENII Publisher Original Code supplied by GENII Foundation.

Downstream maintainers should include a release change file with every source and executable distribution. The record should identify:

1. The date of each change.
2. The changed behavior or files.
3. The Contributor responsible for the Modification.
4. That the Modification derives directly or indirectly from GENII Publisher Original Code provided by GENII Foundation.
5. The public source location and exact deployed revision.

Git history is useful evidence, but a repository history alone may not satisfy the requirement that the distributed Covered Code contain a change file. Include a human-readable change record in the distributed artifact.

## Source notices

Section 3.5 requires the populated Exhibit A notice in each Source Code file. Copy the notice from [SOURCE-NOTICE](../SOURCE-NOTICE) into each covered source file whose format permits comments or other notice text. The copied Exhibit A text must remain exact, although Contributors may add their names to its Contributor field as the license permits.

If a covered source file's format cannot carry the notice, its directory must contain `SOURCE-NOTICE` or an exact copy of that file. This directory fallback follows Section 3.5's instruction to put the notice where a user would be likely to look when a particular file's structure cannot contain it.

Keep a copy of the CPAL license with every Source Code distribution. Repeat the license in documentation that describes recipients' rights or ownership rights in Covered Code.

## Third-party rights and compliance limitations

Use [LEGAL](../LEGAL) for disclosures required by CPAL Section 3.4 and for compliance limitations described by Section 4. Dependency license notices remain separate. Update both kinds of records when their facts change.

## Distribution checklist

Before distributing or externally deploying a modified version:

1. Preserve the populated Exhibit A notice and the full license.
2. Preserve the required Attribution Information, including in Larger Works.
3. Keep the persistent footer on graphical publication surfaces.
4. Publish the corresponding Source Code under CPAL.
5. State clearly where that source is available and identify the deployed revision.
6. Keep the source available for the period required by Section 3.2.
7. Include a dated change file and the required derivation statement.
8. Update `LEGAL` when Sections 3.4 or 4 require a disclosure.
9. Preserve applicable third-party license notices.
10. Include the populated Exhibit A notice in each covered source file or provide the required directory-level `SOURCE-NOTICE` fallback.
