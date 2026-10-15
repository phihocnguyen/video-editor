/**
 * Transport helpers that keep playback authoritative over thumbnail decoding.
 *
 * Decode-hold ownership is entirely here:
 *  - `requestPlay()` acquires the hold on the click stack
 *  - `pausePlayback()` / any `isPlaying → false` releases it
 * PreviewPanel must NOT begin/end the hold in an effect (that raced RAF cleanup
 * and could stop after a single tiny playhead step).
 */

import {
  ensurePlaybackDecodeHold,
  releasePlaybackDecodeHold,
} from "./mediaDecodeGate";
import { resumeInUseMediaVideos } from "./mediaVideoPool";
import { useEditorUiStore } from "../stores/editorUiStore";
import { useProjectStore } from "../stores/projectStore";
import { projectDurationTicks } from "../domain";

/** Begin playback immediately; guarantees a non-zero, non-reversed base rate. */
export function requestPlay(): void {
  ensurePlaybackDecodeHold();

  const ui = useEditorUiStore.getState();
  if (!Number.isFinite(ui.playbackRate) || Math.abs(ui.playbackRate) < 0.01) {
    ui.setPlaybackRate(1);
  }

  // Use the same duration source the RAF clock reads (store), falling back to
  // live project length so "play from end" matches end-of-timeline stop.
  const projectDuration = projectDurationTicks(
    useProjectStore.getState().project.clips,
  );
  const duration = Math.max(ui.durationTicks, projectDuration);
  if (duration > 0 && ui.playheadTicks >= duration - 1) {
    ui.setPlayheadTicks(0);
  }

  ui.setPlaying(true);
  resumeInUseMediaVideos(ui.playbackRate);
}

export function pausePlayback(): void {
  const ui = useEditorUiStore.getState();
  // Premiere stop behavior: halting clears the J/L shuttle so the next Play
  // resumes at 1× instead of mysteriously continuing backward/fast.
  if (ui.playbackRate !== 1) ui.setPlaybackRate(1);
  ui.setPlaying(false);
  releasePlaybackDecodeHold();
}

/** Play/pause toggle shared by the Space bar, topbar button and transport bar. */
export function togglePlay(): void {
  if (useEditorUiStore.getState().isPlaying) pausePlayback();
  else requestPlay();
}
