# Third-party notices

`@genii-foundation/publisher-content` bundles its Markdown parser and Unicode
word-classification data so a published compiler version always executes the
runtime shipped in its own tarball. The bundled runtime contains the following
separately licensed packages:

| Package | Version | License |
| --- | --- | --- |
| `@types/debug` | 4.1.13 | MIT |
| `@types/mdast` | 4.0.4 | MIT |
| `@types/ms` | 2.1.0 | MIT |
| `@types/unist` | 3.0.3 | MIT |
| `@unicode/unicode-15.1.0` | 1.6.17 | MIT |
| `character-entities` | 2.0.2 | MIT |
| `debug` | 4.4.3 | MIT |
| `decode-named-character-reference` | 1.3.0 | MIT |
| `dequal` | 2.0.3 | MIT |
| `devlop` | 1.1.0 | MIT |
| `mdast-util-from-markdown` | 2.0.3 | MIT |
| `mdast-util-to-string` | 4.0.0 | MIT |
| `micromark` | 4.0.2 | MIT |
| `micromark-core-commonmark` | 2.0.3 | MIT |
| `micromark-factory-destination` | 2.0.1 | MIT |
| `micromark-factory-label` | 2.0.1 | MIT |
| `micromark-factory-space` | 2.0.1 | MIT |
| `micromark-factory-title` | 2.0.1 | MIT |
| `micromark-factory-whitespace` | 2.0.1 | MIT |
| `micromark-util-character` | 2.1.1 | MIT |
| `micromark-util-chunked` | 2.0.1 | MIT |
| `micromark-util-classify-character` | 2.0.1 | MIT |
| `micromark-util-combine-extensions` | 2.0.1 | MIT |
| `micromark-util-decode-numeric-character-reference` | 2.0.2 | MIT |
| `micromark-util-decode-string` | 2.0.1 | MIT |
| `micromark-util-encode` | 2.0.1 | MIT |
| `micromark-util-html-tag-name` | 2.0.1 | MIT |
| `micromark-util-normalize-identifier` | 2.0.1 | MIT |
| `micromark-util-resolve-all` | 2.0.1 | MIT |
| `micromark-util-sanitize-uri` | 2.0.1 | MIT |
| `micromark-util-subtokenize` | 2.1.0 | MIT |
| `micromark-util-symbol` | 2.0.1 | MIT |
| `micromark-util-types` | 2.0.2 | MIT |
| `ms` | 2.1.3 | MIT |
| `unist-util-stringify-position` | 4.0.0 | MIT |

These packages remain subject to their own license terms. They are not GENII
Publisher Original Code.

The `@unicode/unicode-15.1.0` package declares the MIT license but does not
publish a standalone license file. GENII Publisher therefore includes
`third-party-licenses/unicode-15.1.0-LICENSE-MIT.txt`, copied from the
package's upstream generator repository, and places that license beside the
bundled runtime files.
