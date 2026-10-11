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

"use client";

import {
  MAXIMUM_READER_PREFERENCES_SERIALIZED_BYTES,
  READER_COLOR_SCHEMES,
  READER_FOCUS_LEVELS,
  READER_FONT_SCALES,
  READER_MOTION_PREFERENCES,
  READER_PREFERENCES_SCHEMA_VERSION,
  createReaderPreferencesStorageKey,
} from "@genii-foundation/publisher-reader/preferences";
import type { ReactElement } from "react";
import type {
  PublisherNextReaderFontFamily,
} from "../types.js";
import {
  createPublisherReaderStateBootstrapSource,
} from "../reader-state-bootstrap-source.js";
import type {
  PublisherReaderStateBootstrapSource,
} from "../reader-state-bootstrap-source.js";

export {
  createPublisherReaderStateBootstrapSource,
} from "../reader-state-bootstrap-source.js";
export type {
  PublisherReaderStateBootstrapSource,
} from "../reader-state-bootstrap-source.js";

export function createPublisherReaderPrepaintSource(
  publicationId: string,
  readerFontFamilies: readonly PublisherNextReaderFontFamily[],
): string {
  const storageKey = createReaderPreferencesStorageKey(publicationId);
  const input = JSON.stringify({
    colorSchemes: READER_COLOR_SCHEMES,
    focusLevels: READER_FOCUS_LEVELS,
    fontFamilies: readerFontFamilies.map(({ family, id }) => ({
      family,
      id,
    })),
    fontScales: READER_FONT_SCALES,
    maximumBytes: MAXIMUM_READER_PREFERENCES_SERIALIZED_BYTES,
    motionPreferences: READER_MOTION_PREFERENCES,
    schemaVersion: READER_PREFERENCES_SCHEMA_VERSION,
    storageKey,
  }).replace(/</gu, "\\u003c");

  return `(()=>{try{const c=${input},s=localStorage.getItem(c.storageKey);if(s===null||new TextEncoder().encode(s).length>c.maximumBytes)return;const p=JSON.parse(s),own=(k)=>Object.prototype.hasOwnProperty.call(p,k),allowed=(values,value)=>values.includes(value),font=c.fontFamilies.find((candidate)=>candidate.id===p.fontFamilyId);if(p===null||typeof p!=="object"||Array.isArray(p)||Object.getPrototypeOf(p)!==Object.prototype||Reflect.ownKeys(p).length!==7||!["schemaVersion","fontScale","fontFamilyId","colorScheme","motion","highlights","focus"].every(own)||p.schemaVersion!==c.schemaVersion||!allowed(c.fontScales,p.fontScale)||font===undefined||!allowed(c.colorSchemes,p.colorScheme)||!allowed(c.motionPreferences,p.motion)||typeof p.highlights!=="boolean"||!allowed(c.focusLevels,p.focus))return;const r=document.documentElement;r.dataset.publisherReaderScheme=p.colorScheme;r.dataset.publisherReaderMotion=p.motion;r.dataset.publisherReaderFocus=p.focus;r.dataset.publisherReaderHighlights=p.highlights?"on":"off";r.style.setProperty("--publisher-reader-font-scale",String(p.fontScale/100));r.style.setProperty("--publisher-reader-font-family",font.family)}catch{}})();`;
}

export function PublisherReaderPrepaint({
  publicationId,
  readerFontFamilies,
  readerStateBootstrapSource,
}: {
  readonly publicationId: string;
  readonly readerFontFamilies: readonly PublisherNextReaderFontFamily[];
  readonly readerStateBootstrapSource?: string;
}): ReactElement {
  return (
    <>
      {readerStateBootstrapSource === undefined ? null : (
        <script
          dangerouslySetInnerHTML={{
            __html: readerStateBootstrapSource,
          }}
          data-publisher-reader-state-bootstrap=""
        />
      )}
      <script
        dangerouslySetInnerHTML={{
          __html: createPublisherReaderPrepaintSource(
            publicationId,
            readerFontFamilies,
          ),
        }}
        data-publisher-reader-prepaint=""
      />
    </>
  );
}
