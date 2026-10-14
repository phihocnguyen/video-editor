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
  statusMessage: string;
  setActivePanel: (panel: EditorPanel) => void;
  setTool: (tool: EditorTool) => void;
  setPlayheadTicks: (ticks: number) => void;
  setTimelineZoom: (zoom: number) => void;
  setPlaying: (playing: boolean) => void;
  setStatusMessage: (message: string) => void;
}

export const useEditorUiStore = create<EditorUiState>((set) => ({
  activePanel: "media",
  tool: "select",
  playheadTicks: 0,
  durationTicks: 30_000_000,
  timelineZoom: 1,
  isPlaying: false,
  statusMessage: "Ready — local desktop editor",
  setActivePanel: (activePanel) => set({ activePanel }),
  setTool: (tool) => set({ tool }),
  setPlayheadTicks: (playheadTicks) => set({ playheadTicks }),
  setTimelineZoom: (timelineZoom) =>
    set({ timelineZoom: Math.min(4, Math.max(0.4, timelineZoom)) }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
}));
