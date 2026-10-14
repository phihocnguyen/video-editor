import { create } from "zustand";
import { useEditorUiStore } from "./editorUiStore";

const STORAGE_KEY = "cutline.settings";

interface SettingsState {
  snapEnabled: boolean;
  hydrate: () => void;
  setSnapEnabled: (enabled: boolean) => void;
}

function readSnap(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { snapEnabled?: boolean };
    return parsed.snapEnabled ?? true;
  } catch {
    return true;
  }
}

function writeSnap(snapEnabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ snapEnabled }));
  } catch {
    /* ignore */
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  snapEnabled: true,
  hydrate: () => {
    const snapEnabled = readSnap();
    set({ snapEnabled });
    useEditorUiStore.getState().setSnapEnabled(snapEnabled);
  },
  setSnapEnabled: (snapEnabled) => {
    writeSnap(snapEnabled);
    set({ snapEnabled });
    useEditorUiStore.getState().setSnapEnabled(snapEnabled);
  },
}));
