import { create } from "zustand";
import type { ProjectDocument } from "../domain";
import { useProjectStore } from "./projectStore";

const MAX_HISTORY = 100;

interface HistoryState {
  past: ProjectDocument[];
  future: ProjectDocument[];
  pushHistory: (before: ProjectDocument) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  pushHistory: (before) =>
    set((state) => ({
      past: [...state.past, before].slice(-MAX_HISTORY),
      future: [],
    })),
  undo: () => {
    const { past, future } = get();
    if (past.length === 0) return;
    const current = useProjectStore.getState().project;
    const previous = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [current, ...future],
    });
    useProjectStore.getState().setProject(previous, { dirty: true });
  },
  redo: () => {
    const { past, future } = get();
    if (future.length === 0) return;
    const current = useProjectStore.getState().project;
    const next = future[0];
    set({
      past: [...past, current],
      future: future.slice(1),
    });
    useProjectStore.getState().setProject(next, { dirty: true });
  },
  clear: () => set({ past: [], future: [] }),
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));

/** Apply a project mutation with undo history. */
export function commitProjectChange(
  mutate: (project: ProjectDocument) => ProjectDocument,
): void {
  const before = useProjectStore.getState().project;
  const after = mutate(before);
  if (after === before) return;
  useHistoryStore.getState().pushHistory(before);
  useProjectStore.getState().setProject(after, { dirty: true });
}
