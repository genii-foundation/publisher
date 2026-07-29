# Third-party notices

`@genii-foundation/publisher-schema` generates and ships compact Unicode
case-fold and canonical-normalization tables so portable repository path
identity does not depend on the host JavaScript runtime's Unicode version.

| Package | Version | License |
| --- | --- | --- |
| `@unicode/unicode-15.1.0` | 1.6.17 | MIT |
| Unicode Character Database | 15.1.0 | Unicode License V3 |

The generated table contains the Unicode 15.1 default case-fold mappings with
CaseFolding statuses C and F. Locale-specific Turkic mappings are not included.
It also contains canonical combining classes and decomposition mappings
derived on every build from the preserved official Unicode 15.1.0
`UnicodeData.txt`, SHA-256
`2fc713e6a31a87c4850a37fe2caffa4218180fadb5de86b43a143ddb4581fb86`.
The exact source URL is
`https://www.unicode.org/Public/15.1.0/ucd/UnicodeData.txt`.

The package also preserves the official Unicode 15.1.0
`NormalizationTest.txt`, SHA-256
`871238e37e3be0696ec2bd0891119a041b052da1a84485eda05a5438724b223e`,
from
`https://www.unicode.org/Public/15.1.0/ucd/NormalizationTest.txt`.
Every schema build runs this conformance suite against the generated
normalization tables. The workspace test gate runs the same suite against the
compiled public normalizer.

This material remains subject to its own license terms. It is not GENII
Publisher Original Code. The upstream package declares the MIT license but
does not publish a standalone license file. GENII Publisher therefore includes
`third-party-licenses/unicode-15.1.0-LICENSE-MIT.txt`, copied from the package's
upstream generator repository. The Unicode Character Database terms are
reproduced in `third-party-licenses/unicode-data-LICENSE.txt`. The exact raw
artifacts are packaged as `third-party-data/UnicodeData-15.1.0.txt` and
`third-party-data/NormalizationTest-15.1.0.txt`.
