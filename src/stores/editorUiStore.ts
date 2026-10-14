import { create } from "zustand";

export type EditorTool = "select" | "hand";

export type EditorPanel =
  | "media"
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
  isPlaying: boolean;
  isScrubbing: boolean;
  snapEnabled: boolean;
  selectedClipIds: string[];
  statusMessage: string;
  setActivePanel: (panel: EditorPanel) => void;
  setTool: (tool: EditorTool) => void;
  setPlayheadTicks: (ticks: number) => void;
  setDurationTicks: (ticks: number) => void;
  setTimelineZoom: (zoom: number) => void;
  setPlaying: (playing: boolean) => void;
  setScrubbing: (scrubbing: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setSelectedClipIds: (ids: string[]) => void;
  setStatusMessage: (message: string) => void;
}

export const useEditorUiStore = create<EditorUiState>((set) => ({
  activePanel: "media",
  tool: "select",
  playheadTicks: 0,
  durationTicks: 30_000_000,
  timelineZoom: 1,
  isPlaying: false,
  isScrubbing: false,
  snapEnabled: true,
  selectedClipIds: [],
  statusMessage: "Ready — local desktop editor",
  setActivePanel: (activePanel) => set({ activePanel }),
  setTool: (tool) => set({ tool }),
  setPlayheadTicks: (playheadTicks) => set({ playheadTicks }),
  setDurationTicks: (durationTicks) => set({ durationTicks }),
  setTimelineZoom: (timelineZoom) =>
    set({ timelineZoom: Math.min(4, Math.max(0.4, timelineZoom)) }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setScrubbing: (isScrubbing) => set({ isScrubbing }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setSelectedClipIds: (selectedClipIds) => set({ selectedClipIds }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
}));
