import { create } from "zustand";
import {
  createEmptyProject,
  type MediaAsset,
  type ProjectDocument,
} from "../domain";

interface ProjectState {
  project: ProjectDocument;
  projectPath: string | null;
  dirty: boolean;
  setProject: (project: ProjectDocument, options?: { dirty?: boolean }) => void;
  setProjectPath: (path: string | null) => void;
  addAssets: (assets: MediaAsset[]) => void;
  newProject: (name?: string) => void;
  markClean: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: createEmptyProject(),
  projectPath: null,
  dirty: false,
  setProject: (project, options) =>
    set({ project, dirty: options?.dirty ?? true }),
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
  newProject: (name) =>
    set({
      project: createEmptyProject(name),
      projectPath: null,
      dirty: false,
    }),
  markClean: () => set({ dirty: false }),
}));
