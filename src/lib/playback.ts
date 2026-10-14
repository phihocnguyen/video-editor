/**
 * Transport helpers that keep playback authoritative over thumbnail decoding.
 *
 * `requestPlay()` runs synchronously on the click/keypress itself: it invalidates
 * any in-flight thumbnail decode *before* Zustand notifies React, so the preview
 * compositor can grab the decoder on the very next frame instead of losing a race
 * to a filmstrip seek that started moments earlier.
 */

import { releaseFilmstripSeekers } from "./mediaFilmstrip";
import { useEditorUiStore } from "../stores/editorUiStore";
import { useProjectStore } from "../stores/projectStore";
import { projectDurationTicks } from "../domain";

/** Begin playback immediately; guarantees a non-zero, non-reversed base rate. */
export function requestPlay(): void {
  // Invalidate in-flight filmstrip seeks only. Do NOT tear down media-bin thumb
  // videos — that steals the UHD decoder and makes the first Play click a no-op
  // (playhead moves, picture stays frozen until the 2nd/3rd press).
  releaseFilmstripSeekers();
  const ui = useEditorUiStore.getState();
  if (!Number.isFinite(ui.playbackRate) || Math.abs(ui.playbackRate) < 0.01) {
    ui.setPlaybackRate(1);
  }
  // Replay from the end: restart at 0 so Play isn't a no-op.
  const duration = projectDurationTicks(useProjectStore.getState().project.clips);
  if (duration > 0 && ui.playheadTicks >= duration - 1) {
    ui.setPlayheadTicks(0);
  }
  ui.setPlaying(true);
}

export function pausePlayback(): void {
  useEditorUiStore.getState().setPlaying(false);
}

/** Play/pause toggle shared by the Space bar, topbar button and transport bar. */
export function togglePlay(): void {
  if (useEditorUiStore.getState().isPlaying) pausePlayback();
  else requestPlay();
}
