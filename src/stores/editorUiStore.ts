import { create } from "zustand";

export type EditorPanel = "media" | "inspector" | "export";

interface EditorUiState {
  activePanel: EditorPanel;
  playheadTicks: number;
  isPlaying: boolean;
  statusMessage: string;
  setActivePanel: (panel: EditorPanel) => void;
  setPlayheadTicks: (ticks: number) => void;
  setPlaying: (playing: boolean) => void;
  setStatusMessage: (message: string) => void;
}

export const useEditorUiStore = create<EditorUiState>((set) => ({
  activePanel: "media",
  playheadTicks: 0,
  isPlaying: false,
  statusMessage: "Ready — local desktop editor (offline-capable)",
  setActivePanel: (activePanel) => set({ activePanel }),
  setPlayheadTicks: (playheadTicks) => set({ playheadTicks }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
}));
