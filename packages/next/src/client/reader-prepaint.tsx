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
import {
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_REPORT_SCHEMA_VERSION,
} from "../types.js";
import type {
  PublisherNextReaderFontFamily,
  PublisherNextReaderStateBootstrapContext,
} from "../types.js";

export interface PublisherReaderStateBootstrapSource {
  readonly package: string;
  readonly version: string;
  readonly sourceHash: string;
  readonly source: string;
  readonly context: PublisherNextReaderStateBootstrapContext;
}

export function createPublisherReaderStateBootstrapSource(
  bootstrap: PublisherReaderStateBootstrapSource,
): string {
  const input = JSON.stringify({
    adapter: {
      package: bootstrap.package,
      version: bootstrap.version,
      sourceHash: bootstrap.sourceHash,
    },
    context: bootstrap.context,
    reportSchemaVersion:
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_REPORT_SCHEMA_VERSION,
  }).replace(/</gu, "\\u003c");

  return `(()=>{const i=${input},context=Object.freeze({...i.context,targetStorageKeys:Object.freeze(i.context.targetStorageKeys)}),record=(value,keys)=>{if(value===null||typeof value!=="object"||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)return null;const descriptors=Object.getOwnPropertyDescriptors(value),owned=Reflect.ownKeys(descriptors);if(owned.length!==keys.length||owned.some((key)=>typeof key!=="string"||!keys.includes(key)))return null;for(const key of keys){const descriptor=descriptors[key];if(descriptor===undefined||!descriptor.enumerable||!("value" in descriptor))return null}return descriptors},labels=(value)=>{if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)return null;const descriptors=Object.getOwnPropertyDescriptors(value),owned=Reflect.ownKeys(descriptors),lengthDescriptor=descriptors.length,length=lengthDescriptor!==undefined&&"value" in lengthDescriptor?lengthDescriptor.value:-1;if(!Number.isSafeInteger(length)||length<0||length>64||owned.length!==length+1)return null;const snapshot=[];for(let index=0;index<length;index+=1){const descriptor=descriptors[String(index)],id=descriptor!==undefined&&"value" in descriptor?descriptor.value:null;if(descriptor===undefined||!descriptor.enumerable||!("value" in descriptor)||typeof id!=="string"||id.length>128||!/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u.test(id)||snapshot.includes(id))return null;snapshot.push(id)}return snapshot};let status="failed",copied=[],refused=[];try{const report=(function(context){"use strict";${bootstrap.source}\n})(context),descriptors=record(report,["schemaVersion","copied","refused"]),acceptedCopied=descriptors===null?null:labels(descriptors.copied.value),acceptedRefused=descriptors===null?null:labels(descriptors.refused.value);if(descriptors!==null&&descriptors.schemaVersion.value===i.reportSchemaVersion&&acceptedCopied!==null&&acceptedRefused!==null&&acceptedCopied.every((id)=>!acceptedRefused.includes(id))){status="completed";copied=acceptedCopied;refused=acceptedRefused}else{status="invalid-report"}}catch{status="failed"}try{document.documentElement.dataset.publisherReaderStateBootstrap=status}catch{}try{localStorage.setItem(context.reportStorageKey,JSON.stringify({schemaVersion:i.reportSchemaVersion,adapter:i.adapter,status,copied,refused}))}catch{}})();`;
}

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
  readerStateBootstrap,
}: {
  readonly publicationId: string;
  readonly readerFontFamilies: readonly PublisherNextReaderFontFamily[];
  readonly readerStateBootstrap?: PublisherReaderStateBootstrapSource;
}): ReactElement {
  return (
    <>
      {readerStateBootstrap === undefined ? null : (
        <script
          dangerouslySetInnerHTML={{
            __html: createPublisherReaderStateBootstrapSource(
              readerStateBootstrap,
            ),
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
