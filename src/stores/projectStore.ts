import { create } from "zustand";
import {
  createEmptyProject,
  normalizeProjectDocument,
  updateCanvas,
  type MediaAsset,
  type ProjectDocument,
} from "../domain";

type CanvasPreset = Partial<ProjectDocument["canvas"]>;

interface ProjectState {
  project: ProjectDocument;
  projectPath: string | null;
  dirty: boolean;
  setProject: (project: ProjectDocument, options?: { dirty?: boolean }) => void;
  setProjectPath: (path: string | null) => void;
  addAssets: (assets: MediaAsset[]) => void;
  newProject: (name?: string, canvas?: CanvasPreset) => void;
  markClean: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: createEmptyProject(),
  projectPath: null,
  dirty: false,
  setProject: (project, options) =>
    set((state) => {
      const dirty = options?.dirty ?? true;
      // Same reference: nothing could have changed (normalization is
      // idempotent for stored projects) — return state untouched so
      // subscribers are NOT notified. Drag gestures rely on this to skip
      // no-op frames without re-rendering the whole timeline.
      if (state.project === project) {
        return state.dirty === dirty ? state : { dirty };
      }
      return {
        project: normalizeProjectDocument(project),
        dirty,
      };
    }),
  setProjectPath: (projectPath) => set({ projectPath }),
  addAssets: (assets) =>
    set((state) => ({
      dirty: true,
      project: {
        ...state.project,
        assets: [...state.project.assets, ...assets],
        updatedAt: new Date().toISOString(),
      },
    })),
  newProject: (name, canvas) => {
    const base = createEmptyProject(name);
    const project = canvas ? updateCanvas(base, canvas) : base;
    set({
      project,
      projectPath: null,
      dirty: false,
    });
  },
  markClean: () => set({ dirty: false }),
}));
