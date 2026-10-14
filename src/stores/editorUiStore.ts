import { create } from "zustand";
import type { Clip } from "../domain/project";

export type EditorTool = "select" | "hand";

export type EditorPanel =
  | "media"
  | "clip"
  | "text"
  | "canvas"
  | "audio"
  | "photos"
  | "subtitles"
  | "export";

interface EditorUiState {
  activePanel: EditorPanel;
  tool: EditorTool;
  playheadTicks: number;
  durationTicks: number;
  timelineZoom: number;
  /** Height of the timeline pane in px (resizable split). */
  timelineHeightPx: number;
  /** Width of timeline track-label column (V/A controls). */
  trackLabelWidthPx: number;
  isPlaying: boolean;
  isScrubbing: boolean;
  snapEnabled: boolean;
  /**
   * Preview shuttle rate (not clip speed).
   * Positive = forward, negative = reverse. Magnitude is speed multiplier.
   */
  playbackRate: number;
  selectedClipIds: string[];
  /** In-app clip clipboard (Ctrl+C / Ctrl+V). */
  clipClipboard: Clip[] | null;
  markInTicks: number | null;
  markOutTicks: number | null;
  statusMessage: string;
  setActivePanel: (panel: EditorPanel) => void;
  setTool: (tool: EditorTool) => void;
  setPlayheadTicks: (ticks: number) => void;
  setDurationTicks: (ticks: number) => void;
  setTimelineZoom: (zoom: number) => void;
  setTimelineHeightPx: (height: number) => void;
  setTrackLabelWidthPx: (width: number) => void;
  setPlaying: (playing: boolean) => void;
  setScrubbing: (scrubbing: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setSelectedClipIds: (ids: string[]) => void;
  setClipClipboard: (clips: Clip[] | null) => void;
  setMarkInTicks: (ticks: number | null) => void;
  setMarkOutTicks: (ticks: number | null) => void;
  setStatusMessage: (message: string) => void;
}

/** Premiere-like shuttle steps for J / L. */
export const PLAYBACK_RATE_STEPS = [
  -4, -2, -1, -0.5, 0.25, 0.5, 1, 1.5, 2, 4,
] as const;

export function nudgePlaybackRate(current: number, direction: 1 | -1): number {
  const steps = PLAYBACK_RATE_STEPS;
  if (current === 0 || !Number.isFinite(current)) {
    return direction > 0 ? 1 : -1;
  }
  // Find nearest step index
  let best = 0;
  let bestDist = Math.abs(steps[0]! - current);
  for (let i = 1; i < steps.length; i += 1) {
    const d = Math.abs(steps[i]! - current);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  const next = Math.min(steps.length - 1, Math.max(0, best + direction));
  return steps[next]!;
}

export const useEditorUiStore = create<EditorUiState>((set) => ({
  activePanel: "media",
  tool: "select",
  playheadTicks: 0,
  durationTicks: 30_000_000,
  timelineZoom: 1,
  timelineHeightPx: 248,
  trackLabelWidthPx: 128,
  isPlaying: false,
  isScrubbing: false,
  snapEnabled: true,
  playbackRate: 1,
  selectedClipIds: [],
  clipClipboard: null,
  markInTicks: null,
  markOutTicks: null,
  statusMessage: "Ready — local desktop editor",
  setActivePanel: (activePanel) => set({ activePanel }),
  setTool: (tool) => set({ tool }),
  setPlayheadTicks: (playheadTicks) =>
    set((s) => (s.playheadTicks === playheadTicks ? s : { playheadTicks })),
  setDurationTicks: (durationTicks) => set({ durationTicks }),
  setTimelineZoom: (timelineZoom) =>
    set({ timelineZoom: Math.min(4, Math.max(0.4, timelineZoom)) }),
  setTimelineHeightPx: (timelineHeightPx) =>
    set({
      timelineHeightPx: Math.min(560, Math.max(160, Math.round(timelineHeightPx))),
    }),
  setTrackLabelWidthPx: (trackLabelWidthPx) =>
    set({
      trackLabelWidthPx: Math.min(260, Math.max(88, Math.round(trackLabelWidthPx))),
    }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setScrubbing: (isScrubbing) => set({ isScrubbing }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setPlaybackRate: (playbackRate) => {
    const rate = Number.isFinite(playbackRate) ? playbackRate : 1;
    const clamped = Math.min(4, Math.max(-4, rate === 0 ? 1 : rate));
    set({ playbackRate: clamped });
  },
  setSelectedClipIds: (selectedClipIds) => set({ selectedClipIds }),
  setClipClipboard: (clipClipboard) => set({ clipClipboard }),
  setMarkInTicks: (markInTicks) => set({ markInTicks }),
  setMarkOutTicks: (markOutTicks) => set({ markOutTicks }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
}));
