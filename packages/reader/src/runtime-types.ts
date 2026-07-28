/*
No alternative license is selected for GENII Publisher Original Code. The alternative-license fields in the required Exhibit A notice below are intentionally unpopulated.

“The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/cpal-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is GENII Publisher.
The Original Developer is not the Initial Developer and is __________. If left blank, the Original Developer is the Initial Developer.
The Initial Developer of the Original Code is GENII Foundation. All portions of the code written by GENII Foundation are Copyright (c) 2026 GENII Foundation. All Rights Reserved.
Contributor ______________________.
Alternatively, the contents of this file may be used under the terms of the _____ license (the [___] License), in which case the provisions of [______] License are applicable instead of those above.
If you wish to allow use of your version of this file only under the terms of the [____] License and not to allow others to use your version of this file under the CPAL, indicate your decision by deleting the provisions above and replace them with the notice and other provisions required by the [___] License. If you do not delete the provisions above, a recipient may use your version of this file under either the CPAL or the [___] License.”
*/

import type {
  ContentAddress,
  ContentRoute,
  PublicationReaderEnvelope,
  ReaderBlock,
  ReaderCollection,
  ReaderSection,
  ReaderWork,
  Sha256Digest,
} from "@genii-foundation/publisher-schema/reader";

export type ReaderAddress = ContentAddress;
export type ReaderRoute = ContentRoute;

export type ReaderLookup<T> =
  | {
      readonly status: "found";
      readonly value: T;
    }
  | {
      readonly status: "not-found";
    }
  | {
      readonly status: "invalid";
      readonly reason: "reference";
    };

export interface ReaderSectionReference {
  readonly workId: string;
  readonly sectionId: string;
}

export interface ReaderBlockReference extends ReaderSectionReference {
  readonly blockId: string;
}

export interface ReaderSectionMatch {
  readonly work: ReaderWork;
  readonly section: ReaderSection;
}

export interface ReaderBlockMatch extends ReaderSectionMatch {
  readonly block: ReaderBlock;
}

export type ReaderContentTarget =
  | {
      readonly kind: "section";
      readonly match: ReaderSectionMatch;
      /** The exact validated address serialization requested by the caller. */
      readonly matchedAddress: ReaderAddress;
    }
  | {
      readonly kind: "block";
      readonly match: ReaderBlockMatch;
      /** The exact validated address serialization requested by the caller. */
      readonly matchedAddress: ReaderAddress;
    };

export type ReaderAddressResolution =
  | {
      readonly status: "resolved";
      readonly requestedAddress: ReaderAddress;
      readonly route: ReaderRoute;
      readonly content: ReaderContentTarget | null;
    }
  | {
      readonly status: "not-found";
      readonly requestedAddress: ReaderAddress;
      readonly baseRoute: ReaderRoute | null;
    }
  | {
      readonly status: "invalid";
      readonly component: "path" | "anchor";
      readonly issue: string;
    };

export type ReaderSectionNavigation =
  | {
      readonly status: "resolved";
      readonly current: ReaderSectionMatch;
      readonly previous: ReaderSectionMatch | null;
      readonly next: ReaderSectionMatch | null;
    }
  | {
      readonly status: "not-found";
    }
  | {
      readonly status: "not-navigable";
    }
  | {
      readonly status: "invalid-reference";
    };

export interface ReaderCollectionWorkReference {
  readonly collectionId: string;
  readonly workId: string;
}

export type ReaderCollectionWorkNavigation =
  | {
      readonly status: "resolved";
      readonly collection: ReaderCollection;
      readonly current: ReaderWork;
      readonly previous: ReaderWork | null;
      readonly next: ReaderWork | null;
    }
  | {
      readonly status:
        | "collection-not-found"
        | "work-not-found"
        | "work-not-in-collection"
        | "invalid-reference";
    };

export type ReaderRelocationScope =
  | {
      readonly kind: "publication";
    }
  | {
      readonly kind: "work";
      readonly workId: string;
    }
  | {
      readonly kind: "section";
      readonly workId: string;
      readonly sectionId: string;
    };

export interface ReaderBlockRelocationQuery {
  readonly contentHash: Sha256Digest;
  readonly scope: ReaderRelocationScope;
}

export type ReaderBlockRelocationResult =
  | {
      readonly status: "found";
      readonly candidates: readonly ReaderBlockMatch[];
    }
  | {
      readonly status: "not-found";
    }
  | {
      readonly status: "invalid";
      readonly reason: "hash" | "scope";
    };

export interface PublicationReaderRuntime {
  readonly envelope: PublicationReaderEnvelope;
  readonly lookupWork: (id: string) => ReaderLookup<ReaderWork>;
  readonly lookupCollection: (
    id: string,
  ) => ReaderLookup<ReaderCollection>;
  readonly lookupSection: (
    reference: ReaderSectionReference,
  ) => ReaderLookup<ReaderSectionMatch>;
  readonly lookupBlock: (
    reference: ReaderBlockReference,
  ) => ReaderLookup<ReaderBlockMatch>;
  readonly lookupContinuityOwner: (
    identity: string,
  ) => ReaderLookup<ReaderSectionMatch>;
  readonly resolveAddress: (
    address: ReaderAddress,
  ) => ReaderAddressResolution;
  readonly sectionNavigation: (
    reference: ReaderSectionReference,
  ) => ReaderSectionNavigation;
  readonly collectionWorkNavigation: (
    reference: ReaderCollectionWorkReference,
  ) => ReaderCollectionWorkNavigation;
  readonly findBlockRelocations: (
    query: ReaderBlockRelocationQuery,
  ) => ReaderBlockRelocationResult;
}
