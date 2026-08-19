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
  READER_NARRATION_PLAYBACK_RATES,
  createReaderNarrationPreferencesStorageKey,
  parseReaderNarrationEnvelope,
  parseReaderNarrationPreferences,
  serializeReaderNarrationPreferences,
  type ReaderNarrationEnvelope,
  type ReaderNarrationPreferences,
} from "@genii-foundation/publisher-reader/narration";
import type { ReaderProgressCatalog } from "@genii-foundation/publisher-reader/progress-catalog";
import type { Sha256Digest } from "@genii-foundation/publisher-schema/reader";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

export interface PublisherReaderNarrationProps {
  readonly active: boolean;
  readonly audioPath: string;
  readonly currentSectionId?: string;
  readonly panelId: string;
  readonly progressCatalog: ReaderProgressCatalog | null;
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
  readonly onClose: () => void;
}

type NarrationLoadState = "idle" | "loading" | "ready" | "absent" | "failed";

function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Playback remains available for this page when storage is unavailable.
  }
}

function formatTime(seconds: number): string {
  const bounded = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(bounded / 3600);
  const minutes = Math.floor((bounded % 3600) / 60);
  const remainder = bounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function PublisherReaderNarration({
  active,
  audioPath,
  currentSectionId,
  panelId,
  progressCatalog,
  publicationId,
  readerBuildId,
  onClose,
}: PublisherReaderNarrationProps): ReactElement {
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingPlayRef = useRef(false);
  const preferencesKey = useMemo(
    () => createReaderNarrationPreferencesStorageKey(publicationId),
    [publicationId],
  );
  const [loadState, setLoadState] = useState<NarrationLoadState>("idle");
  const [envelope, setEnvelope] = useState<ReaderNarrationEnvelope | null>(null);
  const [preferences, setPreferences] = useState<ReaderNarrationPreferences>(() =>
    parseReaderNarrationPreferences(null));
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [selectedClipIndex, setSelectedClipIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const loaded = parseReaderNarrationPreferences(safeRead(preferencesKey));
    setPreferences(loaded);
    setSelectedVoiceId(loaded.selectedVoiceId);
  }, [preferencesKey]);

  useEffect(() => {
    if (!active || loadState !== "idle") return;
    setLoadState("loading");
    void fetch(audioPath, { credentials: "same-origin" })
      .then((response) => {
        if (response.status === 404) {
          setLoadState("absent");
          return null;
        }
        if (!response.ok) throw new Error("Narration request failed.");
        return response.text();
      })
      .then((serialized) => {
        if (serialized === null) return;
        const parsed = parseReaderNarrationEnvelope(serialized, {
          publicationId,
          readerBuildId,
        });
        if (parsed === null) throw new Error("Narration identity mismatch.");
        setEnvelope(parsed);
        setLoadState("ready");
      })
      .catch(() => setLoadState("failed"));
  }, [active, audioPath, loadState, publicationId, readerBuildId]);

  const selectedVoice = useMemo(() => {
    if (envelope === null || envelope.voices.length === 0) return null;
    return envelope.voices.find((voice) => voice.id === selectedVoiceId) ??
      envelope.voices[0] ?? null;
  }, [envelope, selectedVoiceId]);

  useEffect(() => {
    if (selectedVoice === null) return;
    if (selectedVoiceId !== selectedVoice.id) setSelectedVoiceId(selectedVoice.id);
    const currentIndex = currentSectionId === undefined
      ? -1
      : selectedVoice.clips.findIndex((clip) => clip.sectionId === currentSectionId);
    setSelectedClipIndex(currentIndex >= 0 ? currentIndex : 0);
  }, [currentSectionId, selectedVoice?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) return;
    audio.playbackRate = preferences.playbackRate;
  }, [preferences.playbackRate]);

  const selectedClip = selectedVoice?.clips[selectedClipIndex] ?? null;

  useEffect(() => {
    setCurrentTime(0);
    setDuration(selectedClip?.durationSeconds ?? 0);
    setPlaying(false);
    const audio = audioRef.current;
    if (audio === null || selectedClip === null) return;
    audio.load();
    if (pendingPlayRef.current) {
      pendingPlayRef.current = false;
      void audio.play().catch(() => {
        setMessage("Playback is ready. Press play to continue.");
      });
    }
  }, [selectedClip?.audioVersionId, selectedClip?.href]);

  const sectionById = useMemo(
    () => new Map(
      (progressCatalog?.entries ?? []).map((entry) => [entry.id, entry]),
    ),
    [progressCatalog],
  );
  const selectedSection = selectedClip === null
    ? undefined
    : sectionById.get(selectedClip.sectionId);
  const exactDuration = useMemo(
    () => selectedVoice?.clips.reduce(
      (sum, clip) => sum + (clip.durationSeconds ?? 0),
      0,
    ) ?? 0,
    [selectedVoice],
  );
  const timedClipCount = selectedVoice?.clips.filter(
    (clip) => clip.durationSeconds !== undefined,
  ).length ?? 0;

  const updatePreferences = (
    update: Partial<Pick<ReaderNarrationPreferences, "selectedVoiceId" | "playbackRate">>,
  ): void => {
    setPreferences((current) => {
      const next = Object.freeze({ ...current, ...update });
      const serialized = serializeReaderNarrationPreferences(next);
      const accepted = parseReaderNarrationPreferences(serialized);
      safeWrite(preferencesKey, serialized);
      return accepted;
    });
  };

  const chooseVoice = (voiceId: string): void => {
    if (envelope === null) return;
    const nextVoice = envelope.voices.find((voice) => voice.id === voiceId);
    if (nextVoice === undefined) return;
    const previousSectionId = selectedClip?.sectionId ?? currentSectionId;
    const nextIndex = previousSectionId === undefined
      ? -1
      : nextVoice.clips.findIndex((clip) => clip.sectionId === previousSectionId);
    audioRef.current?.pause();
    setSelectedVoiceId(voiceId);
    setSelectedClipIndex(nextIndex >= 0 ? nextIndex : 0);
    updatePreferences({ selectedVoiceId: voiceId });
  };

  const chooseClip = (index: number, play: boolean): void => {
    if (selectedVoice === null || index < 0 || index >= selectedVoice.clips.length) return;
    pendingPlayRef.current = play;
    setMessage("");
    setSelectedClipIndex(index);
  };

  const togglePlayback = (): void => {
    const audio = audioRef.current;
    if (audio === null || selectedClip === null) return;
    setMessage("");
    if (audio.paused) {
      void audio.play().catch(() => setMessage("Playback could not start. Try again."));
    } else {
      audio.pause();
    }
  };

  const seek = (seconds: number): void => {
    const audio = audioRef.current;
    if (audio === null || !Number.isFinite(seconds)) return;
    audio.currentTime = Math.max(0, Math.min(seconds, duration));
    setCurrentTime(audio.currentTime);
  };

  const finishClip = (): void => {
    if (selectedVoice === null) return;
    const nextIndex = selectedClipIndex + 1;
    if (nextIndex < selectedVoice.clips.length) chooseClip(nextIndex, true);
    else setMessage("Narration queue complete.");
  };

  return (
    <>
      <audio
        ref={audioRef}
        src={selectedClip?.href}
        preload="metadata"
        onDurationChange={(event) => {
          const next = event.currentTarget.duration;
          if (Number.isFinite(next)) setDuration(next);
        }}
        onEnded={finishClip}
        onError={() => setMessage("This recording could not load.")}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      />
      {active ? (
        <section
          className="publisher-reader-panel"
          id={panelId}
          aria-label="Listen"
        >
          <header>
            <h2>Listen</h2>
            <button onClick={onClose} type="button" aria-label="Close reader tools">Close</button>
          </header>
          <div className="publisher-reader-narration">
            {loadState === "loading" ? <p role="status">Loading narration.</p> : null}
            {loadState === "absent" ? <p>This publication has no narration.</p> : null}
            {loadState === "failed" ? <p role="alert">Narration could not load. Reading remains available.</p> : null}
            {loadState === "ready" && selectedVoice === null ? <p>No recordings are available yet.</p> : null}
            {selectedVoice === null || selectedClip === null ? null : (
              <>
                <label>
                  Voice
                  <select value={selectedVoice.id} onChange={(event) => chooseVoice(event.currentTarget.value)}>
                    {envelope?.voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>{voice.label}</option>
                    ))}
                  </select>
                </label>
                <div className="publisher-reader-narration-now">
                  <span>Now playing</span>
                  <strong>{selectedSection?.title ?? selectedClip.sectionId}</strong>
                  <small>
                    {new Intl.NumberFormat().format(selectedClipIndex + 1)} of {new Intl.NumberFormat().format(selectedVoice.clips.length)} recordings
                  </small>
                  {selectedSection === undefined ? null : (
                    <a href={selectedSection.href}>Open this section</a>
                  )}
                </div>
                <div className="publisher-reader-narration-controls">
                  <button type="button" onClick={() => chooseClip(selectedClipIndex - 1, playing)} disabled={selectedClipIndex === 0}>Previous</button>
                  <button className="publisher-reader-primary-action" type="button" onClick={togglePlayback}>{playing ? "Pause" : "Play"}</button>
                  <button type="button" onClick={() => chooseClip(selectedClipIndex + 1, playing)} disabled={selectedClipIndex + 1 >= selectedVoice.clips.length}>Next</button>
                </div>
                <label className="publisher-reader-narration-seek">
                  <span>{formatTime(currentTime)}</span>
                  <input
                    aria-label="Recording position"
                    type="range"
                    min={0}
                    max={Math.max(0, duration)}
                    step={0.1}
                    value={Math.min(currentTime, Math.max(0, duration))}
                    onChange={(event) => seek(Number(event.currentTarget.value))}
                  />
                  <span>{formatTime(duration)}</span>
                </label>
                <label>
                  Speed
                  <select
                    value={preferences.playbackRate}
                    onChange={(event) => {
                      const playbackRate = Number(event.currentTarget.value) as ReaderNarrationPreferences["playbackRate"];
                      updatePreferences({ playbackRate });
                    }}
                  >
                    {READER_NARRATION_PLAYBACK_RATES.map((rate) => (
                      <option key={rate} value={rate}>{rate}×</option>
                    ))}
                  </select>
                </label>
                <p className="publisher-reader-narration-summary">
                  {formatTime(exactDuration)} recorded across {new Intl.NumberFormat().format(timedClipCount)} timed clip{timedClipCount === 1 ? "" : "s"}. {new Intl.NumberFormat().format(selectedVoice.unnarratedSectionCount)} section{selectedVoice.unnarratedSectionCount === 1 ? "" : "s"} not yet narrated by this voice.
                </p>
                {message.length === 0 ? null : <p role="status" aria-live="polite">{message}</p>}
              </>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}
