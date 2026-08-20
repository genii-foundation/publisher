/*
No alternative license is selected for GENII Publisher Original Code. The alternative-license fields in the required Exhibit A notice below are intentionally unpopulated.

“The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/cpal-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is GENII Publisher.
The Original Developer is not the Initial Developer and is __________. If left blank, the Original Developer is the Initial Developer.
The Initial Developer of the Original Code is GENII Foundation. All portions of the code written by GENII Foundation are Copyright (c) 2026 GENII Foundation. All Rights Reserved.
Contributor ______________________.
Alternatively, the contents of this file may be used under the terms of the _____ license (the [___] License), in which case the provisions of [______] License are applicable instead of those above.
If you wish to allow use of your version of this file only under the terms of the [____] License and not to allow others to use your version under the CPAL, indicate your decision by deleting the provisions above and replace them with the notice and other provisions required by the [___] License. If you do not delete the provisions above, a recipient may use your version of this file under either the CPAL or the [___] License.”
*/

import {
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_REPORT_SCHEMA_VERSION,
} from "./types.js";
import type {
  PublisherNextReaderStateBootstrapContext,
} from "./types.js";

const READER_STATE_BOOTSTRAP_ARRAY_JOIN = Array.prototype.join;
const READER_STATE_BOOTSTRAP_JSON_STRINGIFY = JSON.stringify;
const READER_STATE_BOOTSTRAP_REFLECT_APPLY = Reflect.apply;
const READER_STATE_BOOTSTRAP_STRING_CHAR_CODE_AT =
  String.prototype.charCodeAt;

function quoteReaderStateBootstrapString(value: string): string {
  const serialized = READER_STATE_BOOTSTRAP_JSON_STRINGIFY(value);
  if (typeof serialized !== "string") {
    throw new TypeError("Reader state bootstrap input is not JSON.");
  }
  return serialized;
}

function escapeReaderStateBootstrapJson(serialized: string): string {
  let escaped = "";
  for (let index = 0; index < serialized.length; index += 1) {
    const code = READER_STATE_BOOTSTRAP_REFLECT_APPLY(
      READER_STATE_BOOTSTRAP_STRING_CHAR_CODE_AT,
      serialized,
      [index],
    );
    if (code === 0x3c) {
      escaped += "\\u003c";
    } else if (code === 0x3e) {
      escaped += "\\u003e";
    } else if (code === 0x2028) {
      escaped += "\\u2028";
    } else if (code === 0x2029) {
      escaped += "\\u2029";
    } else {
      escaped += serialized[index];
    }
  }
  return escaped;
}

export interface PublisherReaderStateBootstrapSource {
  readonly package: string;
  readonly version: string;
  readonly sourceHash: string;
  readonly source: string;
  readonly context: PublisherNextReaderStateBootstrapContext;
  readonly projectionText: string | null;
}

export function createPublisherReaderStateBootstrapSource(
  bootstrap: PublisherReaderStateBootstrapSource,
): string {
  const quote = quoteReaderStateBootstrapString;
  const context = bootstrap.context;
  const target = context.targetStorageKeys;
  const projectionText =
    bootstrap.projectionText === null
      ? "null"
      : quote(bootstrap.projectionText);
  const input = escapeReaderStateBootstrapJson(
    `{"adapter":{"package":${quote(bootstrap.package)},"version":${quote(bootstrap.version)},"sourceHash":${quote(bootstrap.sourceHash)}},"context":{"publicationId":${quote(context.publicationId)},"reportStorageKey":${quote(context.reportStorageKey)},"targetStorageKeys":{"bookmarks":${quote(target.bookmarks)},"engagement":${quote(target.engagement)},"narrationPreferences":${quote(target.narrationPreferences)},"preferences":${quote(target.preferences)},"progress":${quote(target.progress)},"syncConsent":${quote(target.syncConsent)}}},"projectionText":${projectionText},"reportSchemaVersion":${quote(PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_REPORT_SCHEMA_VERSION)}}`,
  );

  const parts = [
    `(()=>{"use strict";`,
    `const arrayObject=Array,arrayPrototype=Array.prototype,jsonObject=JSON,numberObject=Number,objectObject=Object,objectPrototype=Object.prototype,reflectObject=Reflect,stringPrototype=String.prototype;`,
    `const apply=reflectObject.apply,arrayPop=arrayPrototype.pop,arrayPush=arrayPrototype.push,getOwnPropertyDescriptor=objectObject.getOwnPropertyDescriptor,getPrototypeOf=objectObject.getPrototypeOf,isArray=arrayObject.isArray,isSafeInteger=numberObject.isSafeInteger,jsonParse=jsonObject.parse,jsonStringify=jsonObject.stringify,objectCreate=objectObject.create,objectDefineProperty=objectObject.defineProperty,objectFreeze=objectObject.freeze,objectValues=objectObject.values,ownKeys=reflectObject.ownKeys,root=document.documentElement,rootSetAttribute=root.setAttribute,storage=localStorage,storageSetItem=localStorage.setItem,stringCharCodeAt=stringPrototype.charCodeAt;`,
    `const call=(fn,self,args)=>apply(fn,self,args),pop=(values)=>call(arrayPop,values,[]),push=(values,value)=>call(arrayPush,values,[value]),own=(value,key)=>call(getOwnPropertyDescriptor,objectObject,[value,key]),create=()=>call(objectCreate,objectObject,[null]),define=(target,key,value)=>call(objectDefineProperty,objectObject,[target,key,{value,enumerable:true,configurable:false,writable:false}]);`,
    `const freeze=(value)=>{if(value===null||typeof value!=="object")return value;const pending=[value],ordered=[];while(pending.length>0){const current=pop(pending),children=call(objectValues,objectObject,[current]);push(ordered,current);for(let index=0;index<children.length;index+=1){const child=children[index];if(child!==null&&typeof child==="object")push(pending,child)}}for(let index=ordered.length-1;index>=0;index-=1)call(objectFreeze,objectObject,[ordered[index]]);return value};`,
    `const i=freeze(${input}),context=i.context,reportKeys=freeze(["schemaVersion","copied","refused"]);`,
    `const stableLabel=(value)=>{if(typeof value!=="string"||value.length===0||value.length>128)return false;let separator=true;for(let index=0;index<value.length;index+=1){const code=call(stringCharCodeAt,value,[index]),alphanumeric=code>=48&&code<=57||code>=97&&code<=122;if(alphanumeric){separator=false;continue}if((code===45||code===46||code===58||code===95)&&!separator&&index+1<value.length){separator=true;continue}return false}return !separator};`,
    `const record=(value)=>{if(value===null||typeof value!=="object"||call(isArray,arrayObject,[value])||call(getPrototypeOf,objectObject,[value])!==objectPrototype)return null;const keys=call(ownKeys,reflectObject,[value]);if(keys.length!==reportKeys.length)return null;for(let index=0;index<keys.length;index+=1){const key=keys[index];if(typeof key!=="string")return null;let expected=false;for(let expectedIndex=0;expectedIndex<reportKeys.length;expectedIndex+=1){if(reportKeys[expectedIndex]===key){expected=true;break}}if(!expected)return null}const snapshot=create();for(let index=0;index<reportKeys.length;index+=1){const key=reportKeys[index],descriptor=own(value,key);if(descriptor===undefined||descriptor.enumerable!==true||own(descriptor,"value")===undefined)return null;define(snapshot,key,descriptor.value)}return call(objectFreeze,objectObject,[snapshot])};`,
    `const list=(length)=>{const value=create();define(value,"length",length);return value};`,
    `const labels=(value)=>{if(!call(isArray,arrayObject,[value])||call(getPrototypeOf,objectObject,[value])!==arrayPrototype)return null;const keys=call(ownKeys,reflectObject,[value]),lengthDescriptor=own(value,"length"),length=lengthDescriptor!==undefined&&own(lengthDescriptor,"value")!==undefined?lengthDescriptor.value:-1;if(!call(isSafeInteger,numberObject,[length])||length<0||length>64||keys.length!==length+1)return null;const snapshot=list(length);for(let index=0;index<length;index+=1){const descriptor=own(value,index),id=descriptor!==undefined&&own(descriptor,"value")!==undefined?descriptor.value:null;if(descriptor===undefined||descriptor.enumerable!==true||own(descriptor,"value")===undefined||!stableLabel(id))return null;for(let prior=0;prior<index;prior+=1){if(snapshot[prior]===id)return null}define(snapshot,index,id)}return call(objectFreeze,objectObject,[snapshot])};`,
    `const disjoint=(left,right)=>{for(let leftIndex=0;leftIndex<left.length;leftIndex+=1){const id=left[leftIndex];for(let rightIndex=0;rightIndex<right.length;rightIndex+=1){if(right[rightIndex]===id)return false}}return true};`,
    `const outcome=(status,copied,refused)=>{const value=create();define(value,"status",status);define(value,"copied",copied);define(value,"refused",refused);return call(objectFreeze,objectObject,[value])},empty=()=>call(objectFreeze,objectObject,[list(0)]);`,
    `const normalized=(()=>{try{const projection=i.projectionText===null?null:freeze(call(jsonParse,jsonObject,[i.projectionText])),report=(function(context,projection){"use strict";`,
    bootstrap.source,
    `\n})(context,projection),snapshot=record(report),copied=snapshot===null?null:labels(snapshot.copied),refused=snapshot===null?null:labels(snapshot.refused);if(snapshot===null||snapshot.schemaVersion!==i.reportSchemaVersion||copied===null||refused===null||!disjoint(copied,refused))return outcome("invalid-report",empty(),empty());return outcome("completed",copied,refused)}catch{return outcome("failed",empty(),empty())}})();`,
    `const quote=(value)=>call(jsonStringify,jsonObject,[value]),labelText=(values)=>{let text="[";for(let index=0;index<values.length;index+=1){if(index>0)text+=",";text+=quote(values[index])}return text+"]"};`,
    `const reportText="{"+quote("schemaVersion")+":"+quote(i.reportSchemaVersion)+","+quote("adapter")+":{"+quote("package")+":"+quote(i.adapter.package)+","+quote("version")+":"+quote(i.adapter.version)+","+quote("sourceHash")+":"+quote(i.adapter.sourceHash)+"},"+quote("status")+":"+quote(normalized.status)+","+quote("copied")+":"+labelText(normalized.copied)+","+quote("refused")+":"+labelText(normalized.refused)+"}";`,
    `try{call(rootSetAttribute,root,["data-publisher-reader-state-bootstrap",normalized.status])}catch{}try{call(storageSetItem,storage,[context.reportStorageKey,reportText])}catch{}})();`,
  ];
  return READER_STATE_BOOTSTRAP_REFLECT_APPLY(
    READER_STATE_BOOTSTRAP_ARRAY_JOIN,
    parts,
    [""],
  );
}
