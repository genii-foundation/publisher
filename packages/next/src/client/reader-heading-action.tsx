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
  useEffect,
  useRef,
  useState,
} from "react";

type CopyStatus = "copied" | "failed" | null;

const COPY_STARTED_EVENT =
  "genii-publisher-heading-copy-started";
let latestCopyRequest = 0;

async function copyAbsoluteHref(href: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText !== "function") {
      return false;
    }
    await navigator.clipboard.writeText(
      new URL(href, window.location.origin).href,
    );
    return true;
  } catch {
    return false;
  }
}

export function PublisherReaderHeadingAction({
  href,
  title,
}: {
  readonly href: string;
  readonly title: string;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<CopyStatus>(null);
  const mounted = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    setHydrated(true);
    const dismiss = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      setStatus(null);
    };
    window.addEventListener(COPY_STARTED_EVENT, dismiss);
    return () => {
      mounted.current = false;
      window.removeEventListener(COPY_STARTED_EVENT, dismiss);
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    };
  }, []);

  const copy = async () => {
    const request = latestCopyRequest + 1;
    latestCopyRequest = request;
    window.dispatchEvent(new Event(COPY_STARTED_EVENT));
    const copied = await copyAbsoluteHref(href);
    if (!mounted.current || latestCopyRequest !== request) {
      return;
    }
    setStatus(copied ? "copied" : "failed");
    timer.current = window.setTimeout(() => {
      setStatus(null);
      timer.current = null;
    }, 2_400);
  };

  return (
    <>
      <button
        aria-label={`Copy link to ${title}`}
        className="publisher-heading-action"
        data-publisher-heading-href={href}
        data-publisher-reader-transient-ui="true"
        hidden={!hydrated}
        onClick={() => {
          void copy();
        }}
        title="Copy link"
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="18"
          viewBox="0 0 24 24"
          width="18"
        >
          <path
            d="M10.6 13.4a4 4 0 0 0 5.7.1l2.2-2.2a4 4 0 0 0-5.7-5.7l-1.3 1.3m1.9 3.7a4 4 0 0 0-5.7-.1l-2.2 2.2a4 4 0 0 0 5.7 5.7l1.3-1.3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      </button>
      {status === null ? null : (
        <span
          aria-atomic="true"
          aria-live="polite"
          className="publisher-heading-status"
          data-copy-status={status}
          data-publisher-reader-transient-ui="true"
          role="status"
        >
          {status === "copied"
            ? "Link copied"
            : "Unable to copy link"}
        </span>
      )}
    </>
  );
}
